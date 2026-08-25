-- Dos cosas que el mostrador distingue y el sistema no:
--
-- 1. El plan financia el SALDO, no el precio. La restricción exigía
--    financiado = precio − inicial, así que un plan sobre una venta con plata
--    ya pagada era imposible. Ahora el plan guarda su BASE (el saldo que
--    cubre) y la restricción cuadra contra ella; el precio del lote sigue
--    siendo el precio del lote.
--
-- 2. Pagar una cuota NO es lo mismo que ABONAR A CAPITAL. La cuota imputa al
--    cronograma; el abono a capital baja la deuda y REARMA lo que queda —
--    a elección del comprador: menos meses (mismo monto) o misma cantidad de
--    meses con cuota más baja. Antes todo pago con plan iba a cuotas por la
--    fuerza y no había forma de adelantar capital.

alter table public.installment_plans
  add column if not exists base_amount numeric(12,2);
update public.installment_plans set base_amount = total_price where base_amount is null;
alter table public.installment_plans alter column base_amount set not null;

alter table public.installment_plans drop constraint if exists plan_amounts_coherent;
alter table public.installment_plans add constraint plan_amounts_coherent
  check (down_payment <= base_amount and financed_amount = base_amount - down_payment);

-- El plan nace sobre el saldo real y lo deja escrito en base_amount.
create or replace function public.admin_create_installment_plan(
  p_reservation_id uuid,
  p_months int,
  p_monthly_amount numeric,
  p_down_payment numeric default 0,
  p_first_due_date date default null,
  p_annual_interest_pct numeric default 0,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid;
  v_res public.reservations%rowtype;
  v_plan_id uuid;
  v_saldo numeric(12,2);
  v_financed numeric(12,2);
  v_first date;
  v_i int;
  v_amount numeric(12,2);
  v_running numeric(12,2) := 0;
  v_target numeric(12,2);
begin
  v_actor := private.assert_accounting();

  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if v_res.status <> 'confirmada' then raise exception 'RESERVATION_NOT_CONFIRMED'; end if;

  if p_months is null or p_months < 1 or p_months > 480 then raise exception 'INVALID_MONTHS'; end if;
  if p_monthly_amount is null or p_monthly_amount <= 0 then raise exception 'INVALID_MONTHLY'; end if;
  if coalesce(p_down_payment, 0) < 0 then raise exception 'INVALID_DOWN_PAYMENT'; end if;

  select greatest(0,
           coalesce((v_res.client_meta->'reportado'->>'deuda')::numeric, v_res.price_agreed)
           - coalesce((select sum(x.amount_bob) from public.payments x
                        where x.reservation_id = p_reservation_id
                          and x.status = 'aprobado'
                          and x.purpose in ('cuota','abono')), 0))
    into v_saldo;

  if coalesce(p_down_payment, 0) > v_saldo then raise exception 'DOWN_PAYMENT_OVER_PRICE'; end if;
  v_financed := v_saldo - coalesce(p_down_payment, 0);
  if v_financed <= 0 then raise exception 'NOTHING_TO_FINANCE'; end if;

  if coalesce(p_annual_interest_pct, 0) = 0
     and round(p_monthly_amount * (p_months - 1), 2) >= v_financed then
    raise exception 'INVALID_MONTHLY'
      using detail = format('con %s de cuota el financiado %s se paga antes de %s meses',
                            p_monthly_amount, v_financed, p_months);
  end if;

  v_first := coalesce(p_first_due_date, (current_date + interval '1 month')::date);

  insert into public.installment_plans
    (project_id, reservation_id, total_price, base_amount, currency, down_payment,
     financed_amount, months, monthly_amount, annual_interest_pct, first_due_date, note, created_by)
  values
    (v_res.project_id, v_res.id, v_res.price_agreed, v_saldo, v_res.currency,
     coalesce(p_down_payment, 0), v_financed, p_months, p_monthly_amount,
     coalesce(p_annual_interest_pct, 0), v_first, p_note, v_actor)
  returning id into v_plan_id;

  v_target := case when coalesce(p_annual_interest_pct, 0) = 0
                   then v_financed
                   else round(p_monthly_amount * p_months, 2) end;

  for v_i in 1..p_months loop
    if v_i < p_months then
      v_amount := p_monthly_amount;
      v_running := v_running + v_amount;
    else
      v_amount := round(v_target - v_running, 2);
    end if;
    insert into public.installments
      (plan_id, project_id, number, due_date, amount, currency)
    values
      (v_plan_id, v_res.project_id, v_i,
       (v_first + (v_i - 1) * interval '1 month')::date, v_amount, v_res.currency);
  end loop;

  perform private.audit('team', v_actor, null, 'plan.created', v_res.project_id,
    'reservation', v_res.id, null,
    jsonb_build_object('plan_id', v_plan_id, 'meses', p_months, 'cuota', p_monthly_amount,
                       'financiado', v_financed, 'base', v_saldo,
                       'inicial', coalesce(p_down_payment, 0)));

  return jsonb_build_object('plan_id', v_plan_id, 'financed_amount', v_financed,
                            'base_amount', v_saldo, 'first_due_date', v_first);
end;
$fn$;

-- ---- El cobro sabe distinguir cuota de abono a capital.
create or replace function public.admin_register_cuota_payment(
  p_reservation_id uuid,
  p_amount numeric,
  p_paid_on date default null,
  p_provider public.payment_provider_kind default 'efectivo',
  p_reference text default null,
  p_note text default null,
  p_treasury_account_id uuid default null,
  p_currency char(3) default 'BOB',
  p_exchange_rate numeric default null,
  p_destino text default null,
  p_recalculo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid;
  v_res public.reservations%rowtype;
  v_plan public.installment_plans%rowtype;
  v_project public.projects%rowtype;
  v_mz_code text;
  v_lot_number text;
  v_cur char(3);
  v_rate numeric(10,4);
  v_amount_bob numeric(12,2);
  v_fecha timestamptz;
  v_saldo numeric(14,2);
  v_pay_id uuid;
  v_ref text;
  v_left numeric(12,2);
  v_take numeric(12,2);
  v_applied numeric(12,2) := 0;
  v_cuotas int := 0;
  v_row record;
  v_try int := 0;
  v_purpose text;
  v_destino text;
  v_pendiente numeric(12,2);
  v_nuevo_saldo numeric(12,2);
  v_meses int;
  v_cuota numeric(12,2);
  v_i int;
  v_running numeric(12,2) := 0;
  v_next date;
  v_recalc jsonb := null;
begin
  v_actor := private.assert_accounting();

  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_destino is not null and p_destino not in ('cuota','capital') then
    raise exception 'INVALID_DESTINO';
  end if;
  if p_recalculo is not null and p_recalculo not in ('plazo','cuota') then
    raise exception 'INVALID_RECALCULO';
  end if;

  v_cur := upper(coalesce(nullif(btrim(coalesce(p_currency, '')), ''), 'BOB'));
  if v_cur not in ('BOB', 'USD') then raise exception 'INVALID_CURRENCY'; end if;

  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if v_res.status <> 'confirmada' then raise exception 'NO_ES_VENTA'; end if;

  select * into v_plan from public.installment_plans
   where reservation_id = p_reservation_id and status = 'activo';

  -- Con plan, la oficina elige: imputar al cronograma (cuota) o bajar la
  -- deuda y rearmar lo que queda (capital). Sin plan, todo es abono.
  v_destino := case when not found then 'capital' else coalesce(p_destino, 'cuota') end;
  v_purpose := case when v_destino = 'cuota' then 'cuota' else 'abono' end;

  if p_treasury_account_id is not null
     and not exists (select 1 from public.treasury_accounts
                      where id = p_treasury_account_id and is_active) then
    raise exception 'TREASURY_NOT_FOUND';
  end if;

  select * into v_project from public.projects where id = v_res.project_id;
  select m.code, l.number into v_mz_code, v_lot_number
    from public.lots l join public.manzanas m on m.id = l.manzana_id
   where l.id = v_res.lot_id;

  v_rate := coalesce(p_exchange_rate,
                     (private.get_setting(v_res.project_id, 'exchange_rate_bob_per_usd'))::numeric,
                     6.96);
  if v_cur = 'USD' and (v_rate < 1 or v_rate > 100) then
    raise exception 'INVALID_EXCHANGE_RATE';
  end if;

  v_amount_bob := case when v_cur = 'BOB' then p_amount else round(p_amount * v_rate, 2) end;

  select greatest(0,
           coalesce((v_res.client_meta->'reportado'->>'deuda')::numeric, v_res.price_agreed)
           - coalesce((select sum(x.amount_bob) from public.payments x
                        where x.reservation_id = p_reservation_id
                          and x.status = 'aprobado'
                          and x.purpose in ('cuota','abono')), 0))
    into v_saldo;
  if v_amount_bob > v_saldo + 0.01 then
    raise exception 'MONTO_EXCEDE_SALDO'
      using detail = format('saldo %s, cobro %s', v_saldo, v_amount_bob);
  end if;

  v_fecha := case when p_paid_on is null then now()
                  else (p_paid_on::text || ' 12:00:00')::timestamp at time zone 'America/La_Paz'
             end;

  loop
    v_try := v_try + 1;
    v_ref := coalesce(nullif(btrim(coalesce(p_reference, '')), ''),
                      v_project.tracking_prefix || '-C-' || replace(coalesce(v_mz_code, ''), '-', '')
                      || '-' || coalesce(v_lot_number, '') || '-' || private.gen_code(4));
    begin
      insert into public.payments
        (project_id, reservation_id, provider, reference_code, purpose, amount, currency,
         amount_bob, exchange_rate_used, status, verified_by, verified_at, rejection_note,
         treasury_account_id)
      values
        (v_res.project_id, v_res.id, p_provider, v_ref, v_purpose, p_amount, v_cur,
         v_amount_bob, v_rate, 'aprobado', v_actor, v_fecha, p_note, p_treasury_account_id)
      returning id into v_pay_id;
      exit;
    exception when unique_violation then
      if v_try >= 3 or nullif(btrim(coalesce(p_reference, '')), '') is not null then raise; end if;
    end;
  end loop;

  if v_destino = 'cuota' then
    v_left := v_amount_bob;
    for v_row in
      select id, amount - amount_paid as falta
        from public.installments
       where plan_id = v_plan.id and status in ('pendiente', 'parcial')
       order by number
       for update
    loop
      exit when v_left <= 0;
      v_take := least(v_left, v_row.falta);
      if v_take > 0 then
        insert into public.payment_allocations (payment_id, installment_id, amount)
        values (v_pay_id, v_row.id, v_take);
        v_left := round(v_left - v_take, 2);
        v_applied := round(v_applied + v_take, 2);
        v_cuotas := v_cuotas + 1;
      end if;
    end loop;

    update public.installments i
       set paid_at = v_fecha, updated_at = now()
     where i.status = 'pagada' and coalesce(i.paid_at, now()) > v_fecha
       and exists (select 1 from public.payment_allocations pa
                    where pa.installment_id = i.id and pa.payment_id = v_pay_id);

  elsif v_plan.id is not null then
    -- ABONO A CAPITAL: baja la deuda y rearma el cronograma que falta. Las
    -- cuotas ya pagadas no se tocan — son historia.
    select coalesce(sum(amount - amount_paid), 0) into v_pendiente
      from public.installments
     where plan_id = v_plan.id and status in ('pendiente','parcial');
    v_nuevo_saldo := round(v_pendiente - v_amount_bob, 2);

    -- Las pendientes se reemplazan por el cronograma nuevo.
    update public.installments
       set status = 'anulada', updated_at = now()
     where plan_id = v_plan.id and status in ('pendiente','parcial');

    if v_nuevo_saldo <= 0.01 then
      -- El abono canceló el plan entero.
      update public.installment_plans
         set status = 'completado',
             note = coalesce(note || ' · ', '') || 'cancelado por abono a capital',
             updated_at = now()
       where id = v_plan.id;
      v_recalc := jsonb_build_object('modo', 'cancelado', 'meses', 0, 'cuota', 0);
    else
      if coalesce(p_recalculo, 'plazo') = 'plazo' then
        -- Misma cuota, menos meses: el clásico «lo quiero terminar antes».
        v_cuota := v_plan.monthly_amount;
        v_meses := greatest(1, ceil(v_nuevo_saldo / v_cuota)::int);
      else
        -- Mismo plazo restante, cuota más baja.
        select count(*) into v_meses from public.installments
         where plan_id = v_plan.id and status = 'anulada'
           and due_date >= current_date;
        v_meses := greatest(1, v_meses);
        v_cuota := ceil(v_nuevo_saldo / v_meses * 100) / 100;
      end if;

      select coalesce(max(number), 0) into v_i from public.installments where plan_id = v_plan.id;
      v_next := greatest(current_date + interval '1 month',
                         coalesce((select min(due_date) from public.installments
                                    where plan_id = v_plan.id and status = 'anulada'
                                      and due_date >= current_date),
                                  current_date + interval '1 month'))::date;

      for v_i in 1..v_meses loop
        v_amount_bob := case when v_i < v_meses then v_cuota
                             else round(v_nuevo_saldo - v_running, 2) end;
        v_running := round(v_running + v_cuota, 2);
        insert into public.installments
          (plan_id, project_id, number, due_date, amount, currency)
        values
          (v_plan.id, v_res.project_id,
           (select coalesce(max(number), 0) + 1 from public.installments where plan_id = v_plan.id),
           (v_next + (v_i - 1) * interval '1 month')::date, v_amount_bob, v_plan.currency);
      end loop;

      update public.installment_plans
         set months = v_meses, monthly_amount = v_cuota,
             base_amount = base_amount - v_amount_bob,
             financed_amount = financed_amount,
             first_due_date = v_next,
             note = coalesce(note || ' · ', '') || 'abono a capital', updated_at = now()
       where id = v_plan.id;
      v_recalc := jsonb_build_object('modo', coalesce(p_recalculo, 'plazo'),
                                     'meses', v_meses, 'cuota', v_cuota,
                                     'saldo_plan', v_nuevo_saldo);
    end if;
    v_applied := 0;
    v_left := 0;
  end if;

  perform private.audit('team', v_actor, null,
    case when v_destino = 'cuota' then 'cuota.registered' else 'abono.registered' end,
    v_res.project_id, 'reservation', v_res.id,
    null, jsonb_build_object('payment_id', v_pay_id, 'monto', p_amount, 'moneda', v_cur,
                             'cambio', v_rate, 'tipo', v_purpose, 'destino', v_destino,
                             'forma', p_provider, 'recalculo', v_recalc,
                             'aplicado', v_applied, 'sobrante', v_left, 'cuotas', v_cuotas));

  return jsonb_build_object(
    'payment_id', v_pay_id, 'reference_code', v_ref, 'tipo', v_purpose,
    'destino', v_destino, 'moneda', v_cur, 'cambio', v_rate,
    'aplicado', v_applied, 'sobrante', coalesce(v_left, 0), 'cuotas_afectadas', v_cuotas,
    'plan_recalculado', v_recalc);
end;
$fn$;

revoke execute on function public.admin_register_cuota_payment(
  uuid, numeric, date, public.payment_provider_kind, text, text, uuid, char, numeric, text, text)
  from public, anon;
grant execute on function public.admin_register_cuota_payment(
  uuid, numeric, date, public.payment_provider_kind, text, text, uuid, char, numeric, text, text)
  to authenticated, service_role;
