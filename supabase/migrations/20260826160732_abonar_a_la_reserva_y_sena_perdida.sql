-- La reserva se puede ABONAR, y la seña de una reserva caída se pierde.
--
-- Cómo funciona el mostrador de verdad: la persona paga la seña, el lote le
-- queda guardado un tiempo, y en ese plazo va juntando la cuota inicial. Si
-- junta, la reserva se vuelve venta y todo lo abonado cuenta. Si no junta, la
-- reserva vence, el lote vuelve a la vitrina y la seña se pierde.
--
-- Hasta ahora eso no se podía registrar: el cobro exigía que la reserva ya
-- fuera venta, así que la plata de alguien que estaba juntando no tenía dónde
-- entrar.

-- ---- 0. Limpieza: quedaba la firma vieja de 9 argumentos conviviendo con la
--         nueva de 11. Con parámetros nombrados la llamada podía caer en la
--         vieja, que no sabe de destino ni de recálculo.
drop function if exists public.admin_register_cuota_payment(
  uuid, numeric, date, public.payment_provider_kind, text, text, uuid, char, numeric);

-- ---- 1. La cuenta donde caen las señas que se pierden.
insert into public.chart_of_accounts (code, name, kind)
select '4411', 'Señas de Reservas No Concretadas', 'ingreso'
 where not exists (select 1 from public.chart_of_accounts where code = '4411');

-- ---- 2. Cobrar sobre una reserva VIVA: es un abono a cuenta de su compra.
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
  v_mz_code text; v_lot_number text;
  v_cur char(3); v_rate numeric(10,4); v_pago_bob numeric(12,2);
  v_fecha timestamptz; v_saldo numeric(14,2);
  v_pay_id uuid; v_ref text;
  v_left numeric(12,2); v_take numeric(12,2);
  v_applied numeric(12,2) := 0; v_cuotas int := 0;
  v_interes_pago numeric(12,2) := 0; v_int_pend numeric(12,2); v_int_take numeric(12,2);
  v_row record; v_try int := 0;
  v_purpose text; v_destino text; v_es_reserva boolean;
  v_principal numeric(12,2); v_nuevo numeric(12,2);
  v_tasa numeric; v_meses int; v_cuota numeric(12,2);
  v_interes numeric(12,2); v_capital numeric(12,2); v_pend numeric(12,2);
  v_i int; v_num int; v_next date; v_recalc jsonb := null;
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

  -- Se cobra sobre una venta viva O sobre una reserva viva (el comprador está
  -- juntando su cuota inicial). Sobre una vencida o cancelada, no: primero se
  -- reactiva, y para eso está «Reactivar reserva».
  v_es_reserva := v_res.status in ('pendiente_pago','en_verificacion','rechazo_reintento');
  if v_res.status <> 'confirmada' and not v_es_reserva then
    raise exception 'RESERVA_NO_VIVA'
      using detail = 'La reserva está ' || v_res.status || '. Reactivala antes de cobrarle.';
  end if;

  select * into v_plan from public.installment_plans
   where reservation_id = p_reservation_id and status = 'activo';
  v_destino := case when not found then 'capital' else coalesce(p_destino, 'cuota') end;
  v_purpose := case when v_destino = 'cuota' then 'cuota' else 'abono' end;
  v_tasa := coalesce(v_plan.monthly_interest_pct, 0);

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

  v_saldo := greatest(0, private.base_del_lote(p_reservation_id)
                        - private.capital_pagado(p_reservation_id));
  if v_destino = 'cuota' then
    select coalesce(sum(greatest(0, i.interes - least(i.amount_paid, i.interes))), 0)
      into v_int_pend from public.installments i
     where i.plan_id = v_plan.id and i.status in ('pendiente','parcial');
    v_saldo := v_saldo + v_int_pend;
  end if;
  if v_pago_bob > v_saldo + 0.01 then
    raise exception 'MONTO_EXCEDE_SALDO'
      using detail = format('máximo cobrable %s, cobro %s', v_saldo, v_pago_bob);
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
      select id, amount, interes, amount_paid, amount - amount_paid as falta
        from public.installments
       where plan_id = v_plan.id and status in ('pendiente', 'parcial')
       order by number
       for update
    loop
      exit when v_left <= 0;
      v_take := least(v_left, v_row.falta);
      if v_take > 0 then
        v_int_pend := greatest(0, v_row.interes - least(v_row.amount_paid, v_row.interes));
        v_int_take := least(v_take, v_int_pend);
        v_interes_pago := round(v_interes_pago + v_int_take, 2);
        insert into public.payment_allocations (payment_id, installment_id, amount)
        values (v_pay_id, v_row.id, v_take);
        v_left := round(v_left - v_take, 2);
        v_applied := round(v_applied + v_take, 2);
        v_cuotas := v_cuotas + 1;
      end if;
    end loop;

    update public.payments set interest_bob = v_interes_pago where id = v_pay_id;

    update public.installments i
       set paid_at = v_fecha, updated_at = now()
     where i.status = 'pagada' and coalesce(i.paid_at, now()) > v_fecha
       and exists (select 1 from public.payment_allocations pa
                    where pa.installment_id = i.id and pa.payment_id = v_pay_id);

  elsif v_plan.id is not null then
    select coalesce(sum((i.amount - i.interes) - greatest(0, i.amount_paid - i.interes)), 0)
      into v_principal
      from public.installments i
     where i.plan_id = v_plan.id and i.status in ('pendiente','parcial');
    v_nuevo := round(v_principal - v_pago_bob, 2);

    select count(*) into v_meses from public.installments
     where plan_id = v_plan.id and status in ('pendiente','parcial') and due_date >= current_date;
    select min(due_date) into v_next from public.installments
     where plan_id = v_plan.id and status in ('pendiente','parcial') and due_date >= current_date;
    v_next := coalesce(v_next, (current_date + interval '1 month')::date);

    update public.installments set status = 'anulada', updated_at = now()
     where plan_id = v_plan.id and status in ('pendiente','parcial');

    if v_nuevo <= 0.01 then
      update public.installment_plans
         set status = 'completado',
             base_amount = greatest(0, base_amount - v_pago_bob),
             financed_amount = greatest(0, base_amount - v_pago_bob - down_payment),
             note = coalesce(note || ' · ', '') || 'cancelado por abono a capital',
             updated_at = now()
       where id = v_plan.id;
      v_recalc := jsonb_build_object('modo','cancelado','meses',0,'cuota',0,'saldo_plan',0);
    else
      if coalesce(p_recalculo, 'plazo') = 'plazo' then
        v_cuota := v_plan.monthly_amount;
        if v_tasa > 0 then
          if v_cuota <= round(v_nuevo * v_tasa / 100, 2) then
            raise exception 'CUOTA_NO_CUBRE_INTERES'
              using detail = format('la cuota %s no cubre el interés mensual de %s',
                                    v_cuota, round(v_nuevo * v_tasa / 100, 2));
          end if;
          v_meses := greatest(1, ceil(
            ln(v_cuota / (v_cuota - v_nuevo * v_tasa / 100)) / ln(1 + v_tasa / 100))::int);
        else
          v_meses := greatest(1, ceil(v_nuevo / v_cuota)::int);
        end if;
      else
        v_meses := greatest(1, v_meses);
        v_cuota := case when v_tasa > 0
                        then round(v_nuevo * (v_tasa/100) / (1 - power(1 + v_tasa/100, -v_meses)), 2)
                        else ceil(v_nuevo / v_meses * 100) / 100 end;
      end if;

      select coalesce(max(number), 0) into v_num from public.installments where plan_id = v_plan.id;
      v_pend := v_nuevo;
      for v_i in 1..v_meses loop
        if v_tasa > 0 then
          v_interes := round(v_pend * v_tasa / 100, 2);
          v_capital := case when v_i < v_meses then round(v_cuota - v_interes, 2) else v_pend end;
        else
          v_interes := 0;
          v_capital := case when v_i < v_meses then v_cuota else v_pend end;
        end if;
        v_pend := round(v_pend - v_capital, 2);
        v_num := v_num + 1;
        insert into public.installments
          (plan_id, project_id, number, due_date, amount, interes, currency)
        values
          (v_plan.id, v_res.project_id, v_num,
           (v_next + (v_i - 1) * interval '1 month')::date,
           round(v_capital + v_interes, 2), v_interes, v_plan.currency);
      end loop;

      update public.installment_plans
         set months = v_meses, monthly_amount = v_cuota,
             base_amount = greatest(0, base_amount - v_pago_bob),
             financed_amount = greatest(0, base_amount - v_pago_bob - down_payment),
             first_due_date = v_next,
             note = coalesce(note || ' · ', '') || 'abono a capital', updated_at = now()
       where id = v_plan.id;
      v_recalc := jsonb_build_object('modo', coalesce(p_recalculo, 'plazo'),
                                     'meses', v_meses, 'cuota', v_cuota,
                                     'saldo_plan', v_nuevo);
    end if;
    v_applied := 0; v_left := 0;
  end if;

  perform private.audit('team', v_actor, null,
    case when v_destino = 'cuota' then 'cuota.registered' else 'abono.registered' end,
    v_res.project_id, 'reservation', v_res.id,
    null, jsonb_build_object('payment_id', v_pay_id, 'monto', p_amount, 'moneda', v_cur,
                             'monto_bob', v_pago_bob, 'interes', v_interes_pago,
                             'capital', v_pago_bob - v_interes_pago,
                             'sobre_reserva', v_es_reserva,
                             'tipo', v_purpose, 'destino', v_destino,
                             'forma', p_provider, 'recalculo', v_recalc,
                             'aplicado', v_applied, 'sobrante', v_left, 'cuotas', v_cuotas));

  return jsonb_build_object(
    'payment_id', v_pay_id, 'reference_code', v_ref, 'tipo', v_purpose,
    'destino', v_destino, 'sobre_reserva', v_es_reserva,
    'moneda', v_cur, 'cambio', v_rate, 'monto_bob', v_pago_bob,
    'interes', v_interes_pago, 'capital', v_pago_bob - v_interes_pago,
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
