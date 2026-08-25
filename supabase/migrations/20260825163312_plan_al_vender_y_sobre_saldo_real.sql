-- El plan de pago se decide AL VENDER, no después.
--
-- 1. admin_create_installment_plan ahora financia el SALDO REAL: la deuda
--    base (reportada para migradas, precio para nativas) menos lo ya cobrado.
--    Antes financiaba el precio completo e ignoraba lo pagado: a un migrado
--    con Bs 10.000 abonados le cronogramaba deuda que ya no existía. Para una
--    venta nueva sin pagos el resultado es idéntico al de antes.
-- 2. mark_sold_offline acepta el plan ahí mismo: modalidad crédito + plazo,
--    cuota y primer vencimiento — la venta sale del mostrador con su
--    cronograma armado y su contrato lo dice.

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

  -- El saldo REAL: la misma cuenta de v_ventas. Lo ya cobrado no se
  -- cronograma dos veces.
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

  -- Una cuota tan alta que el plan termina antes del plazo es un dedo
  -- resbalado: la última cuota saldría negativa.
  if coalesce(p_annual_interest_pct, 0) = 0
     and round(p_monthly_amount * (p_months - 1), 2) >= v_financed then
    raise exception 'INVALID_MONTHLY'
      using detail = format('con %s de cuota el financiado %s se paga antes de %s meses',
                            p_monthly_amount, v_financed, p_months);
  end if;

  v_first := coalesce(p_first_due_date, (current_date + interval '1 month')::date);

  insert into public.installment_plans
    (project_id, reservation_id, total_price, currency, down_payment, financed_amount,
     months, monthly_amount, annual_interest_pct, first_due_date, note, created_by)
  values
    (v_res.project_id, v_res.id, v_res.price_agreed, v_res.currency, coalesce(p_down_payment, 0),
     v_financed, p_months, p_monthly_amount, coalesce(p_annual_interest_pct, 0), v_first,
     p_note, v_actor)
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
                       'financiado', v_financed, 'saldo_base', v_saldo,
                       'inicial', coalesce(p_down_payment, 0)));

  return jsonb_build_object('plan_id', v_plan_id, 'financed_amount', v_financed,
                            'first_due_date', v_first);
end;
$fn$;

-- ---- Vender con el plan armado en el mismo acto.
drop function if exists public.mark_sold_offline(
  uuid, text, text, text, text, numeric, text, public.payment_provider_kind,
  text, char, numeric, uuid, numeric);

create or replace function public.mark_sold_offline(
  p_lot_id uuid, p_full_name text, p_ci text, p_phone text,
  p_email text default null, p_amount numeric default null, p_note text default null,
  p_provider public.payment_provider_kind default 'manual_qr',
  p_modalidad text default null,
  p_currency char(3) default 'BOB',
  p_exchange_rate numeric default null,
  p_treasury_account_id uuid default null,
  p_price numeric default null,
  p_plan_months int default null,
  p_plan_monthly numeric default null,
  p_plan_first_due date default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $function$
declare
  v_actor uuid; v_lot public.lots%rowtype; v_project public.projects%rowtype;
  v_mz_code text; v_price numeric(12,2); v_rate numeric(10,4);
  v_cur char(3); v_amount numeric(12,2); v_amount_bob numeric(12,2);
  v_modalidad text;
  v_code text; v_ref text; v_res_id uuid; v_email text; v_pay_id uuid;
  v_plan jsonb;
begin
  v_actor := private.assert_admin();
  v_email := private.exigir_correo(p_email);

  v_cur := upper(coalesce(nullif(btrim(coalesce(p_currency, '')), ''), 'BOB'));
  if v_cur not in ('BOB','USD') then raise exception 'INVALID_CURRENCY'; end if;
  if p_modalidad is not null and p_modalidad not in ('contado','credito') then
    raise exception 'INVALID_MODALIDAD';
  end if;
  if p_price is not null and p_price <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_treasury_account_id is not null
     and not exists (select 1 from public.treasury_accounts
                      where id = p_treasury_account_id and is_active) then
    raise exception 'TREASURY_NOT_FOUND';
  end if;

  update public.lots set status = 'vendido'
   where id = p_lot_id and status = 'disponible' and deleted_at is null
  returning * into v_lot;
  if not found then raise exception 'LOT_NOT_AVAILABLE'; end if;

  select * into v_project from public.projects where id = v_lot.project_id;
  select code into v_mz_code from public.manzanas where id = v_lot.manzana_id;

  v_price := coalesce(p_price, public.lot_price(v_lot.id), 0);

  v_rate := coalesce(p_exchange_rate,
                     (private.get_setting(v_lot.project_id, 'exchange_rate_bob_per_usd'))::numeric,
                     6.96);
  if v_cur = 'USD' and (v_rate < 1 or v_rate > 100) then
    raise exception 'INVALID_EXCHANGE_RATE';
  end if;

  v_amount := coalesce(p_amount, case when v_cur = 'BOB' then v_price
                                      else round(v_price / v_rate, 2) end);
  v_amount_bob := case when v_cur = 'BOB' then v_amount else round(v_amount * v_rate, 2) end;

  if v_amount_bob > v_price + 0.01 then
    raise exception 'MONTO_EXCEDE_SALDO'
      using detail = format('precio %s, cobro %s', v_price, v_amount_bob);
  end if;
  v_modalidad := coalesce(p_modalidad,
                          case when v_amount_bob >= v_price - 0.01 then 'contado' else 'credito' end);
  if v_modalidad = 'contado' and v_amount_bob < v_price - 0.01 then
    raise exception 'MONTO_NO_CUBRE_CONTADO'
      using detail = format('precio %s, cobro %s', v_price, v_amount_bob);
  end if;
  if v_modalidad = 'contado' and p_plan_months is not null then
    raise exception 'CONTADO_NO_LLEVA_PLAN';
  end if;

  v_code := private.gen_tracking_code(v_project.tracking_prefix);
  insert into public.reservations
    (project_id, lot_id, tracking_code, buyer_full_name, buyer_ci, buyer_ci_normalized,
     buyer_phone, buyer_email, status, price_agreed, amount_due, amount_due_currency,
     currency, source, verified_by, confirmed_at, client_meta)
  values
    (v_lot.project_id, v_lot.id, v_code, btrim(p_full_name), p_ci, private.normalize_ci(p_ci),
     private.normalize_phone_bo(p_phone), v_email, 'confirmada',
     v_price, v_amount, v_project.currency, v_project.currency, 'oficina', v_actor, now(),
     jsonb_build_object('origen', 'oficina_directa', 'modalidad', v_modalidad))
  returning id into v_res_id;

  update public.lots set active_reservation_id = v_res_id where id = v_lot.id;

  if v_amount > 0 then
    v_ref := v_project.tracking_prefix || '-' || replace(v_mz_code, '-', '') || '-'
             || v_lot.number || '-' || private.gen_code(4);
    insert into public.payments
      (project_id, reservation_id, provider, reference_code, purpose, amount, currency,
       amount_bob, exchange_rate_used, status, verified_by, verified_at, rejection_note,
       treasury_account_id)
    values
      (v_lot.project_id, v_res_id, coalesce(p_provider, 'manual_qr'), v_ref, 'abono',
       v_amount, v_cur, v_amount_bob, v_rate, 'aprobado', v_actor, now(), p_note,
       p_treasury_account_id)
    returning id into v_pay_id;
  end if;

  -- El plan, en el mismo acto: financia lo que queda tras la inicial (la
  -- función del plan ya calcula sobre el saldo real, así que no se duplica).
  if v_modalidad = 'credito' and p_plan_months is not null then
    if p_plan_monthly is null or p_plan_monthly <= 0 then raise exception 'INVALID_MONTHLY'; end if;
    v_plan := public.admin_create_installment_plan(
      v_res_id, p_plan_months, p_plan_monthly, 0, p_plan_first_due, 0,
      'creado al vender en oficina');
  end if;

  perform private.audit('team', v_actor, null, 'lot.sold_offline', v_lot.project_id,
    'reservation', v_res_id, null,
    jsonb_build_object('lot_id', v_lot.id, 'monto', v_amount, 'moneda', v_cur,
                       'cambio', v_rate, 'monto_bob', v_amount_bob,
                       'modalidad', v_modalidad, 'precio', v_price,
                       'plan', v_plan->>'plan_id',
                       'origen', 'oficina_directa',
                       'forma_de_pago', coalesce(p_provider, 'manual_qr'), 'nota', p_note));

  return jsonb_build_object('tracking_code', v_code, 'reservation_id', v_res_id,
                            'payment_id', v_pay_id, 'modalidad', v_modalidad,
                            'plan_id', v_plan->>'plan_id');
end;
$function$;

revoke execute on function public.mark_sold_offline(
  uuid, text, text, text, text, numeric, text, public.payment_provider_kind,
  text, char, numeric, uuid, numeric, int, numeric, date) from public, anon;
grant execute on function public.mark_sold_offline(
  uuid, text, text, text, text, numeric, text, public.payment_provider_kind,
  text, char, numeric, uuid, numeric, int, numeric, date)
  to authenticated, service_role;
