-- Accounting, part 2: the operations.
--
-- Every write goes through here rather than through table grants, for the same
-- reason lot status does: a schedule half-written, or a payment recorded without
-- being applied to a cuota, is worse than no accounting at all — it looks right
-- and is wrong. Each function does the whole job in one transaction.
--
-- Reading is NOT here. installments/plans/allocations are readable by the team
-- through RLS, so reports are plain queries from the app; only money going out
-- (expenses) is admin-only.

-- 'efectivo' added to payment_provider_kind in the previous migration: cuotas
-- are largely paid in cash at the counter, and a report that calls that
-- "manual_qr" is lying about how the money arrived.

-- ============================================================================
-- Create the payment plan for a confirmed sale
-- ============================================================================
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
  v_financed numeric(12,2);
  v_first date;
  v_i int;
  v_amount numeric(12,2);
  v_running numeric(12,2) := 0;
  v_target numeric(12,2);
begin
  v_actor := private.assert_admin();

  select * into v_res from public.reservations where id = p_reservation_id;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  -- A plan is a debt. It only exists once the sale is real.
  if v_res.status <> 'confirmada' then raise exception 'RESERVATION_NOT_CONFIRMED'; end if;

  if p_months is null or p_months < 1 or p_months > 480 then raise exception 'INVALID_MONTHS'; end if;
  if p_monthly_amount is null or p_monthly_amount <= 0 then raise exception 'INVALID_MONTHLY'; end if;
  if coalesce(p_down_payment, 0) < 0 then raise exception 'INVALID_DOWN_PAYMENT'; end if;
  if coalesce(p_down_payment, 0) > v_res.price_agreed then raise exception 'DOWN_PAYMENT_OVER_PRICE'; end if;

  v_financed := v_res.price_agreed - coalesce(p_down_payment, 0);
  if v_financed <= 0 then raise exception 'NOTHING_TO_FINANCE'; end if;

  v_first := coalesce(p_first_due_date, (current_date + interval '1 month')::date);

  insert into public.installment_plans
    (project_id, reservation_id, total_price, currency, down_payment, financed_amount,
     months, monthly_amount, annual_interest_pct, first_due_date, note, created_by)
  values
    (v_res.project_id, v_res.id, v_res.price_agreed, v_res.currency, coalesce(p_down_payment, 0),
     v_financed, p_months, p_monthly_amount, coalesce(p_annual_interest_pct, 0), v_first,
     p_note, v_actor)
  returning id into v_plan_id;

  -- Without interest the cuotas must add up to exactly what is financed, so the
  -- last one absorbs the rounding: 12 x 2.066,75 would otherwise leave centavos
  -- owing forever and the plan would never close itself.
  -- With interest the agreed monthly figure stands as given and the total is
  -- simply higher than the financed amount — that difference IS the interest.
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

    if v_amount <= 0 then
      raise exception 'MONTHLY_TOO_HIGH_FOR_TERM';
    end if;

    insert into public.installments (plan_id, project_id, number, due_date, amount, currency)
    values (v_plan_id, v_res.project_id, v_i,
            (v_first + make_interval(months => v_i - 1))::date, v_amount, v_res.currency);
  end loop;

  perform private.audit('team', v_actor, null, 'plan.created', v_res.project_id,
    'reservation', v_res.id,
    null, jsonb_build_object('plan_id', v_plan_id, 'cuotas', p_months,
                             'mensual', p_monthly_amount, 'inicial', coalesce(p_down_payment, 0),
                             'financiado', v_financed, 'primera', v_first));

  return jsonb_build_object('plan_id', v_plan_id, 'cuotas', p_months, 'financiado', v_financed);
end;
$fn$;

-- ============================================================================
-- Register a cuota payment and apply it
-- ============================================================================
create or replace function public.admin_register_cuota_payment(
  p_reservation_id uuid,
  p_amount numeric,
  p_paid_on date default null,
  p_provider public.payment_provider_kind default 'efectivo',
  p_reference text default null,
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
  v_actor := private.assert_admin();

  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  select * into v_res from public.reservations where id = p_reservation_id;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;

  select * into v_plan from public.installment_plans
   where reservation_id = p_reservation_id and status = 'activo';
  if not found then raise exception 'NO_ACTIVE_PLAN'; end if;

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
         amount_bob, exchange_rate_used, status, verified_by, verified_at, rejection_note)
      values
        (v_res.project_id, v_res.id, p_provider, v_ref, 'cuota', p_amount, v_res.currency,
         v_amount_bob, v_rate, 'aprobado', v_actor,
         coalesce(p_paid_on::timestamptz, now()), p_note)
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

  -- A leftover is not an error — the buyer may have overpaid, and the office
  -- needs to see it rather than have it silently vanish.
  return jsonb_build_object(
    'payment_id', v_pay_id, 'reference_code', v_ref,
    'aplicado', v_applied, 'sobrante', v_left, 'cuotas_afectadas', v_cuotas);
end;
$fn$;

-- ============================================================================
-- Cancel a plan (keeps the row and its history)
-- ============================================================================
create or replace function public.admin_cancel_installment_plan(p_plan_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid;
  v_plan public.installment_plans%rowtype;
begin
  v_actor := private.assert_admin();
  if btrim(coalesce(p_note, '')) = '' then raise exception 'NOTE_REQUIRED'; end if;

  update public.installment_plans
     set status = 'cancelado', note = p_note, updated_at = now()
   where id = p_plan_id and status <> 'cancelado'
  returning * into v_plan;
  if not found then raise exception 'PLAN_NOT_CANCELLABLE'; end if;

  -- Unpaid cuotas stop being owed; paid ones stay as they are, because the
  -- money really did come in and the reports must keep showing it.
  update public.installments
     set status = 'anulada', updated_at = now()
   where plan_id = p_plan_id and status in ('pendiente', 'parcial');

  perform private.audit('team', v_actor, null, 'plan.cancelled', v_plan.project_id,
    'reservation', v_plan.reservation_id,
    null, jsonb_build_object('plan_id', p_plan_id, 'nota', p_note));

  return jsonb_build_object('ok', true);
end;
$fn$;

-- ============================================================================
-- Expenses
-- ============================================================================
create or replace function public.admin_record_expense(
  p_project_id uuid,
  p_incurred_on date,
  p_category public.expense_category,
  p_description text,
  p_amount numeric,
  p_currency char(3) default null,
  p_supplier text default null,
  p_receipt_storage_path text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid;
  v_project public.projects%rowtype;
  v_cur char(3);
  v_rate numeric(10,4);
  v_bob numeric(12,2);
  v_id uuid;
begin
  v_actor := private.assert_admin();

  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if btrim(coalesce(p_description, '')) = '' then raise exception 'DESCRIPTION_REQUIRED'; end if;
  if p_incurred_on is null or p_incurred_on > current_date + 1 then raise exception 'INVALID_DATE'; end if;

  select * into v_project from public.projects where id = p_project_id;
  if not found then raise exception 'PROJECT_NOT_FOUND'; end if;

  v_cur := coalesce(p_currency, v_project.currency);
  v_rate := coalesce((private.get_setting(p_project_id, 'exchange_rate_bob_per_usd'))::numeric, 6.96);
  v_bob := case when v_cur = 'BOB' then p_amount else round(p_amount * v_rate, 2) end;

  insert into public.expenses
    (project_id, incurred_on, category, description, supplier, amount, currency,
     amount_bob, exchange_rate_used, receipt_storage_path, note, created_by)
  values
    (p_project_id, p_incurred_on, p_category, btrim(p_description),
     nullif(btrim(coalesce(p_supplier, '')), ''), p_amount, v_cur, v_bob, v_rate,
     p_receipt_storage_path, nullif(btrim(coalesce(p_note, '')), ''), v_actor)
  returning id into v_id;

  perform private.audit('team', v_actor, null, 'expense.created', p_project_id,
    'expense', v_id,
    null, jsonb_build_object('monto', p_amount, 'moneda', v_cur, 'categoria', p_category,
                             'fecha', p_incurred_on, 'detalle', btrim(p_description)));

  return jsonb_build_object('expense_id', v_id, 'amount_bob', v_bob);
end;
$fn$;

-- Soft delete: an expense that was already counted in a closed month must stay
-- recoverable and stay in the audit trail.
create or replace function public.admin_delete_expense(p_expense_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid;
  v_exp public.expenses%rowtype;
begin
  v_actor := private.assert_admin();
  if btrim(coalesce(p_note, '')) = '' then raise exception 'NOTE_REQUIRED'; end if;

  update public.expenses set deleted_at = now(), updated_at = now()
   where id = p_expense_id and deleted_at is null
  returning * into v_exp;
  if not found then raise exception 'EXPENSE_NOT_FOUND'; end if;

  perform private.audit('team', v_actor, null, 'expense.deleted', v_exp.project_id,
    'expense', p_expense_id,
    jsonb_build_object('monto', v_exp.amount, 'detalle', v_exp.description),
    jsonb_build_object('nota', p_note));

  return jsonb_build_object('ok', true);
end;
$fn$;

-- ============================================================================
-- Permissions — same as every other team RPC: never anon.
-- ============================================================================
revoke execute on function
  public.admin_create_installment_plan(uuid, int, numeric, numeric, date, numeric, text),
  public.admin_register_cuota_payment(uuid, numeric, date, public.payment_provider_kind, text, text),
  public.admin_cancel_installment_plan(uuid, text),
  public.admin_record_expense(uuid, date, public.expense_category, text, numeric, char, text, text, text),
  public.admin_delete_expense(uuid, text)
from public, anon;

grant execute on function
  public.admin_create_installment_plan(uuid, int, numeric, numeric, date, numeric, text),
  public.admin_register_cuota_payment(uuid, numeric, date, public.payment_provider_kind, text, text),
  public.admin_cancel_installment_plan(uuid, text),
  public.admin_record_expense(uuid, date, public.expense_category, text, numeric, char, text, text, text),
  public.admin_delete_expense(uuid, text)
to authenticated, service_role;
