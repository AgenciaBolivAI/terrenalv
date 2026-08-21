-- Cada cobro dice a qué cuenta entró la plata.

drop function if exists public.admin_register_cuota_payment(
  uuid, numeric, date, public.payment_provider_kind, text, text);

create function public.admin_register_cuota_payment(
  p_reservation_id uuid,
  p_amount numeric,
  p_paid_on date default null,
  p_provider public.payment_provider_kind default 'efectivo',
  p_reference text default null,
  p_note text default null,
  p_treasury_account_id uuid default null
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
  v_rate numeric(10,4);
  v_amount_bob numeric(12,2);
  v_pay_id uuid;
  v_ref text;
  v_left numeric(12,2);
  v_take numeric(12,2);
  v_applied numeric(12,2) := 0;
  v_cuotas int := 0;
  v_row record;
  v_try int := 0;
begin
  v_actor := private.assert_accounting();

  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  select * into v_res from public.reservations where id = p_reservation_id;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;

  select * into v_plan from public.installment_plans
   where reservation_id = p_reservation_id and status = 'activo';
  if not found then raise exception 'NO_ACTIVE_PLAN'; end if;

  if p_treasury_account_id is not null
     and not exists (select 1 from public.treasury_accounts
                      where id = p_treasury_account_id and is_active) then
    raise exception 'TREASURY_NOT_FOUND';
  end if;

  select * into v_project from public.projects where id = v_res.project_id;
  select m.code, l.number into v_mz_code, v_lot_number
    from public.lots l join public.manzanas m on m.id = l.manzana_id
   where l.id = v_res.lot_id;

  v_rate := coalesce((private.get_setting(v_res.project_id, 'exchange_rate_bob_per_usd'))::numeric, 6.96);
  v_amount_bob := case when v_res.currency = 'BOB' then p_amount
                       else round(p_amount * v_rate, 2) end;

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
        (v_res.project_id, v_res.id, p_provider, v_ref, 'cuota', p_amount, v_res.currency,
         v_amount_bob, v_rate, 'aprobado', v_actor,
         coalesce(p_paid_on::timestamptz, now()), p_note, p_treasury_account_id)
      returning id into v_pay_id;
      exit;
    exception when unique_violation then
      -- A reference the caller typed by hand is theirs to fix; only a generated
      -- one may be retried.
      if v_try >= 3 or nullif(btrim(coalesce(p_reference, '')), '') is not null then raise; end if;
    end;
  end loop;

  -- Waterfall: oldest unpaid cuota first, which is what both the office and the
  -- buyer assume is happening, and what keeps the mora figure honest.
  v_left := p_amount;
  for v_row in
    select id, amount - amount_paid as falta
      from public.installments
     where plan_id = v_plan.id and status in ('pendiente', 'parcial')
     order by number
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

  perform private.audit('team', v_actor, null, 'cuota.registered', v_res.project_id,
    'reservation', v_res.id,
    null, jsonb_build_object('payment_id', v_pay_id, 'monto', p_amount,
                             'aplicado', v_applied, 'sobrante', v_left, 'cuotas', v_cuotas));

  return jsonb_build_object(
    'payment_id', v_pay_id, 'reference_code', v_ref,
    'aplicado', v_applied, 'sobrante', v_left, 'cuotas_afectadas', v_cuotas);
end;
$fn$;

-- Al aprobar un comprobante subido por el comprador, quien aprueba indica en
-- qué cuenta se acreditó. Es opcional: si no lo sabe, el asiento cae en 1111
-- como antes y se puede corregir después.
drop function if exists public.approve_payment(uuid);

create function public.approve_payment(p_payment_id uuid, p_treasury_account_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid;
  v_pay public.payments%rowtype;
  v_res public.reservations%rowtype;
begin
  v_actor := private.assert_team();

  select * into v_pay from public.payments where id = p_payment_id;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;

  select * into v_res from public.reservations where id = v_pay.reservation_id for update;
  select * into v_pay from public.payments where id = p_payment_id for update;

  if v_pay.status <> 'comprobante_subido' then raise exception 'PAYMENT_NOT_REVIEWABLE'; end if;
  if v_res.status <> 'en_verificacion' then raise exception 'RESERVATION_NOT_IN_REVIEW'; end if;

  if p_treasury_account_id is not null
     and not exists (select 1 from public.treasury_accounts
                      where id = p_treasury_account_id and is_active) then
    raise exception 'TREASURY_NOT_FOUND';
  end if;

  update public.payments
     set status = 'aprobado', verified_by = v_actor, verified_at = now(),
         treasury_account_id = coalesce(p_treasury_account_id, treasury_account_id)
   where id = v_pay.id;

  update public.reservations
     set status = 'confirmada', confirmed_at = now(), verified_by = v_actor
   where id = v_res.id;

  update public.lots
     set status = 'vendido'
   where id = v_res.lot_id and active_reservation_id = v_res.id and status = 'reservado';

  perform private.notify(
    v_res.project_id, 'pago_aprobado', 'normal',
    'Pago aprobado',
    format('%s — %s', v_res.tracking_code, v_res.buyer_full_name),
    'reservation', v_res.id,
    jsonb_build_object('tracking_code', v_res.tracking_code),
    p_buyer_email => v_res.buyer_email,
    p_buyer_template => 'buyer_reserva_confirmada');

  perform private.audit('team', v_actor, null, 'payment.approved', v_res.project_id,
    'payment', v_pay.id, jsonb_build_object('status', 'comprobante_subido'),
    jsonb_build_object('status', 'aprobado'));

  return jsonb_build_object('status', 'confirmada');
end;
$fn$;

revoke execute on function
  public.admin_register_cuota_payment(uuid, numeric, date, public.payment_provider_kind, text, text, uuid),
  public.approve_payment(uuid, uuid)
from public, anon;
grant execute on function
  public.admin_register_cuota_payment(uuid, numeric, date, public.payment_provider_kind, text, text, uuid),
  public.approve_payment(uuid, uuid)
to authenticated, service_role;
