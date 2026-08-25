-- Corrección del rearmado por abono a capital: el bucle de cuotas nuevas
-- reutilizaba la variable del monto del pago y la pisaba, así que el plan
-- terminaba restando de su base el valor de la última cuota en vez del abono
-- (y financiado dejaba de cuadrar con base − inicial). Variables separadas.
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
  v_pago_bob numeric(12,2);
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
  v_cuota_i numeric(12,2);
  v_i int;
  v_num int;
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

  v_pago_bob := case when v_cur = 'BOB' then p_amount else round(p_amount * v_rate, 2) end;

  select greatest(0,
           coalesce((v_res.client_meta->'reportado'->>'deuda')::numeric, v_res.price_agreed)
           - coalesce((select sum(x.amount_bob) from public.payments x
                        where x.reservation_id = p_reservation_id
                          and x.status = 'aprobado'
                          and x.purpose in ('cuota','abono')), 0))
    into v_saldo;
  if v_pago_bob > v_saldo + 0.01 then
    raise exception 'MONTO_EXCEDE_SALDO'
      using detail = format('saldo %s, cobro %s', v_saldo, v_pago_bob);
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
         v_pago_bob, v_rate, 'aprobado', v_actor, v_fecha, p_note, p_treasury_account_id)
      returning id into v_pay_id;
      exit;
    exception when unique_violation then
      if v_try >= 3 or nullif(btrim(coalesce(p_reference, '')), '') is not null then raise; end if;
    end;
  end loop;

  if v_destino = 'cuota' then
    v_left := v_pago_bob;
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
    -- ABONO A CAPITAL: baja la deuda y rearma lo que falta. Lo pagado no se toca.
    select coalesce(sum(amount - amount_paid), 0) into v_pendiente
      from public.installments
     where plan_id = v_plan.id and status in ('pendiente','parcial');
    v_nuevo_saldo := round(v_pendiente - v_pago_bob, 2);

    select count(*) into v_meses from public.installments
     where plan_id = v_plan.id and status in ('pendiente','parcial') and due_date >= current_date;
    select min(due_date) into v_next from public.installments
     where plan_id = v_plan.id and status in ('pendiente','parcial') and due_date >= current_date;
    v_next := coalesce(v_next, (current_date + interval '1 month')::date);

    update public.installments
       set status = 'anulada', updated_at = now()
     where plan_id = v_plan.id and status in ('pendiente','parcial');

    if v_nuevo_saldo <= 0.01 then
      update public.installment_plans
         set status = 'completado', base_amount = base_amount - v_pago_bob,
             financed_amount = base_amount - v_pago_bob - down_payment,
             note = coalesce(note || ' · ', '') || 'cancelado por abono a capital',
             updated_at = now()
       where id = v_plan.id;
      v_recalc := jsonb_build_object('modo', 'cancelado', 'meses', 0, 'cuota', 0, 'saldo_plan', 0);
    else
      if coalesce(p_recalculo, 'plazo') = 'plazo' then
        v_cuota := v_plan.monthly_amount;
        v_meses := greatest(1, ceil(v_nuevo_saldo / v_cuota)::int);
      else
        v_meses := greatest(1, v_meses);
        v_cuota := ceil(v_nuevo_saldo / v_meses * 100) / 100;
      end if;

      select coalesce(max(number), 0) into v_num from public.installments where plan_id = v_plan.id;
      for v_i in 1..v_meses loop
        v_cuota_i := case when v_i < v_meses then v_cuota
                          else round(v_nuevo_saldo - v_running, 2) end;
        v_running := round(v_running + v_cuota, 2);
        v_num := v_num + 1;
        insert into public.installments
          (plan_id, project_id, number, due_date, amount, currency)
        values
          (v_plan.id, v_res.project_id, v_num,
           (v_next + (v_i - 1) * interval '1 month')::date, v_cuota_i, v_plan.currency);
      end loop;

      update public.installment_plans
         set months = v_meses, monthly_amount = v_cuota,
             base_amount = base_amount - v_pago_bob,
             financed_amount = base_amount - v_pago_bob - down_payment,
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
                             'cambio', v_rate, 'monto_bob', v_pago_bob,
                             'tipo', v_purpose, 'destino', v_destino,
                             'forma', p_provider, 'recalculo', v_recalc,
                             'aplicado', v_applied, 'sobrante', v_left, 'cuotas', v_cuotas));

  return jsonb_build_object(
    'payment_id', v_pay_id, 'reference_code', v_ref, 'tipo', v_purpose,
    'destino', v_destino, 'moneda', v_cur, 'cambio', v_rate, 'monto_bob', v_pago_bob,
    'aplicado', v_applied, 'sobrante', coalesce(v_left, 0), 'cuotas_afectadas', v_cuotas,
    'plan_recalculado', v_recalc);
end;
$fn$;
