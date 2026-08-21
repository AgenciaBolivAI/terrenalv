-- Team/admin RPCs + public read RPCs. Team functions are SECURITY DEFINER and
-- self-authorize via private.assert_team()/assert_admin() — UI gating is convenience,
-- these checks are the enforcement. Lock ordering everywhere: reservation → lot.

-- Service-role calls (seed scripts, future bank webhooks) carry no auth.uid();
-- they authenticate by the service key itself, so the role claim is sufficient.
create or replace function private.is_service()
returns boolean
language sql
stable
as $$
  select coalesce((select auth.jwt()->>'role'), '') = 'service_role';
$$;

create or replace function private.assert_team()
returns uuid
language plpgsql
stable
set search_path = public, private
as $$
begin
  if not private.is_team() and not private.is_service() then
    raise exception 'NO_AUTORIZADO';
  end if;
  return auth.uid();
end;
$$;

create or replace function private.assert_admin()
returns uuid
language plpgsql
stable
set search_path = public, private
as $$
begin
  if not private.is_admin() and not private.is_service() then
    raise exception 'NO_AUTORIZADO';
  end if;
  return auth.uid();
end;
$$;

-- Auto-create a profile when an invited auth user is created.
create or replace function private.tg_create_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    case when new.raw_user_meta_data->>'role' = 'admin' then 'admin'::public.team_role
         else 'ventas'::public.team_role end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.tg_create_profile();

-- ============================================================================
-- Verification queue actions
-- ============================================================================
create or replace function public.approve_payment(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
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

  update public.payments
     set status = 'aprobado', verified_by = v_actor, verified_at = now()
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
$$;

create or replace function public.reject_payment(
  p_payment_id uuid,
  p_reason public.rejection_reason_kind,
  p_note text default null,
  p_allow_retry boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_actor uuid;
  v_pay public.payments%rowtype;
  v_res public.reservations%rowtype;
  v_retry_h int;
  v_new_status public.reservation_status;
begin
  v_actor := private.assert_team();

  select * into v_pay from public.payments where id = p_payment_id;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;

  select * into v_res from public.reservations where id = v_pay.reservation_id for update;
  select * into v_pay from public.payments where id = p_payment_id for update;

  if v_pay.status <> 'comprobante_subido' then raise exception 'PAYMENT_NOT_REVIEWABLE'; end if;
  if v_res.status <> 'en_verificacion' then raise exception 'RESERVATION_NOT_IN_REVIEW'; end if;

  update public.payments
     set status = 'rechazado', verified_by = v_actor, verified_at = now(),
         rejection_reason = p_reason, rejection_note = p_note
   where id = v_pay.id;

  if p_allow_retry then
    v_retry_h := coalesce((private.get_setting(v_res.project_id, 'retry_hours'))::int, 24);
    v_new_status := 'rechazo_reintento';
    update public.reservations
       set status = 'rechazo_reintento',
           retry_expires_at = now() + make_interval(hours => v_retry_h)
     where id = v_res.id;
  else
    v_new_status := 'cancelada';
    update public.reservations
       set status = 'cancelada', cancelled_at = now(),
           cancel_reason = 'comprobante_rechazado'
     where id = v_res.id;
    update public.lots
       set status = 'disponible', active_reservation_id = null
     where id = v_res.lot_id and active_reservation_id = v_res.id and status = 'reservado';
  end if;

  perform private.notify(
    v_res.project_id, 'pago_rechazado', 'normal',
    'Comprobante rechazado',
    format('%s — %s (%s)', v_res.tracking_code, v_res.buyer_full_name, p_reason),
    'reservation', v_res.id,
    jsonb_build_object('tracking_code', v_res.tracking_code, 'motivo', p_reason,
                       'permite_reintento', p_allow_retry),
    p_buyer_email => v_res.buyer_email,
    p_buyer_template => 'buyer_comprobante_rechazado');

  perform private.audit('team', v_actor, null, 'payment.rejected', v_res.project_id,
    'payment', v_pay.id, jsonb_build_object('status', 'comprobante_subido'),
    jsonb_build_object('status', 'rechazado', 'motivo', p_reason, 'nota', p_note,
                       'permite_reintento', p_allow_retry));

  return jsonb_build_object('status', v_new_status);
end;
$$;

-- "Buyer paid but never uploaded" — the most common week-1 support case.
create or replace function public.attach_payment_on_behalf(
  p_reservation_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_actor uuid;
  v_res public.reservations%rowtype;
  v_pay public.payments%rowtype;
begin
  v_actor := private.assert_team();
  if p_note is null or btrim(p_note) = '' then raise exception 'NOTE_REQUIRED'; end if;

  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if v_res.status not in ('pendiente_pago', 'en_verificacion', 'rechazo_reintento') then
    raise exception 'RESERVATION_NOT_ACTIVE';
  end if;

  select * into v_pay from public.payments
  where reservation_id = v_res.id and purpose = 'reserva'
  order by created_at desc limit 1
  for update;

  update public.payments
     set status = 'aprobado', verified_by = v_actor, verified_at = now(),
         rejection_note = p_note
   where id = v_pay.id;

  update public.reservations
     set status = 'confirmada', confirmed_at = now(), verified_by = v_actor,
         hold_expires_at = null, retry_expires_at = null
   where id = v_res.id;

  update public.lots
     set status = 'vendido'
   where id = v_res.lot_id and active_reservation_id = v_res.id and status = 'reservado';

  perform private.notify(
    v_res.project_id, 'pago_aprobado', 'normal',
    'Pago registrado por el equipo',
    format('%s — %s', v_res.tracking_code, v_res.buyer_full_name),
    'reservation', v_res.id,
    jsonb_build_object('tracking_code', v_res.tracking_code, 'nota', p_note),
    p_buyer_email => v_res.buyer_email,
    p_buyer_template => 'buyer_reserva_confirmada');

  perform private.audit('team', v_actor, null, 'payment.attached_on_behalf', v_res.project_id,
    'reservation', v_res.id, null, jsonb_build_object('nota', p_note));

  return jsonb_build_object('status', 'confirmada');
end;
$$;

-- ============================================================================
-- Reservation admin actions
-- ============================================================================
create or replace function public.admin_extend_hold(p_reservation_id uuid, p_hours int)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_actor uuid;
  v_res public.reservations%rowtype;
begin
  v_actor := private.assert_team();
  if p_hours is null or p_hours < 1 or p_hours > 720 then raise exception 'INVALID_HOURS'; end if;

  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;

  if v_res.status = 'pendiente_pago' then
    update public.reservations
       set hold_expires_at = greatest(hold_expires_at, now()) + make_interval(hours => p_hours)
     where id = v_res.id;
  elsif v_res.status = 'rechazo_reintento' then
    update public.reservations
       set retry_expires_at = greatest(retry_expires_at, now()) + make_interval(hours => p_hours)
     where id = v_res.id;
  else
    raise exception 'RESERVATION_NOT_PENDING';
  end if;

  perform private.audit('team', v_actor, null, 'reservation.hold_extended', v_res.project_id,
    'reservation', v_res.id, null, jsonb_build_object('horas', p_hours));

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_cancel_reservation(p_reservation_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_actor uuid;
  v_res public.reservations%rowtype;
begin
  v_actor := private.assert_admin();

  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if v_res.status not in ('pendiente_pago', 'en_verificacion', 'rechazo_reintento') then
    raise exception 'RESERVATION_NOT_ACTIVE';
  end if;

  update public.reservations
     set status = 'cancelada', cancelled_at = now(),
         cancel_reason = coalesce(p_note, 'cancelada_por_admin'),
         hold_expires_at = null, retry_expires_at = null
   where id = v_res.id;

  update public.payments set status = 'cancelado'
   where reservation_id = v_res.id and status in ('pendiente', 'comprobante_subido');

  update public.lots
     set status = 'disponible', active_reservation_id = null
   where id = v_res.lot_id and active_reservation_id = v_res.id and status = 'reservado';

  perform private.notify(
    v_res.project_id, 'reserva_cancelada', 'baja', 'Reserva cancelada por el equipo',
    format('%s — %s', v_res.tracking_code, v_res.buyer_full_name),
    'reservation', v_res.id,
    jsonb_build_object('tracking_code', v_res.tracking_code, 'nota', p_note));

  perform private.audit('team', v_actor, null, 'reservation.cancelled_by_admin',
    v_res.project_id, 'reservation', v_res.id,
    jsonb_build_object('status', v_res.status),
    jsonb_build_object('status', 'cancelada', 'nota', p_note));

  return jsonb_build_object('status', 'cancelada');
end;
$$;

-- Un-sell: reverts a confirmed sale (dispute/refund handled offline). Admin-only, audited.
create or replace function public.admin_revert_sale(p_reservation_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_actor uuid;
  v_res public.reservations%rowtype;
begin
  v_actor := private.assert_admin();
  if p_note is null or btrim(p_note) = '' then raise exception 'NOTE_REQUIRED'; end if;

  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if v_res.status <> 'confirmada' then raise exception 'RESERVATION_NOT_CONFIRMED'; end if;

  update public.reservations
     set status = 'cancelada', cancelled_at = now(), cancel_reason = p_note
   where id = v_res.id;

  update public.lots
     set status = 'disponible', active_reservation_id = null
   where id = v_res.lot_id and active_reservation_id = v_res.id and status = 'vendido';

  perform private.audit('team', v_actor, null, 'reservation.sale_reverted',
    v_res.project_id, 'reservation', v_res.id,
    jsonb_build_object('status', 'confirmada'),
    jsonb_build_object('status', 'cancelada', 'nota', p_note));

  return jsonb_build_object('status', 'cancelada');
end;
$$;

create or replace function public.admin_reinstate_reservation(p_reservation_id uuid, p_hours int default 24)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_actor uuid;
  v_res public.reservations%rowtype;
  v_flipped boolean;
begin
  v_actor := private.assert_team();

  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if v_res.status not in ('expirada', 'cancelada') then raise exception 'RESERVATION_NOT_REINSTATABLE'; end if;

  update public.lots
     set status = 'reservado', active_reservation_id = v_res.id
   where id = v_res.lot_id and status = 'disponible'
     and state = 'published' and deleted_at is null;
  v_flipped := found;
  if not v_flipped then raise exception 'LOT_NOT_AVAILABLE'; end if;

  update public.reservations
     set status = 'pendiente_pago',
         hold_expires_at = now() + make_interval(hours => coalesce(p_hours, 24)),
         expired_at = null, cancelled_at = null, cancel_reason = null
   where id = v_res.id;

  update public.payments set status = 'pendiente'
   where reservation_id = v_res.id and purpose = 'reserva' and status = 'cancelado';

  perform private.audit('team', v_actor, null, 'reservation.reinstated',
    v_res.project_id, 'reservation', v_res.id, null,
    jsonb_build_object('horas', p_hours));

  return jsonb_build_object('status', 'pendiente_pago');
end;
$$;

-- Walk-in cash sale at the office: reservation + approved payment in one step,
-- so the one-active-per-lot invariant covers offline sales too.
create or replace function public.mark_sold_offline(
  p_lot_id uuid,
  p_full_name text,
  p_ci text,
  p_phone text,
  p_email text default null,
  p_amount numeric default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_actor uuid;
  v_lot public.lots%rowtype;
  v_project public.projects%rowtype;
  v_mz_code text;
  v_price numeric(12,2);
  v_rate numeric(10,4);
  v_amount numeric(12,2);
  v_code text;
  v_ref text;
  v_res_id uuid;
begin
  v_actor := private.assert_admin();

  update public.lots
     set status = 'vendido'
   where id = p_lot_id and status = 'disponible' and deleted_at is null
  returning * into v_lot;
  if not found then raise exception 'LOT_NOT_AVAILABLE'; end if;

  select * into v_project from public.projects where id = v_lot.project_id;
  select code into v_mz_code from public.manzanas where id = v_lot.manzana_id;
  v_price := coalesce(public.lot_price(v_lot.id), 0);
  v_amount := coalesce(p_amount, v_price);
  v_rate := coalesce((private.get_setting(v_lot.project_id, 'exchange_rate_bob_per_usd'))::numeric, 6.96);

  v_code := private.gen_tracking_code(v_project.tracking_prefix);
  insert into public.reservations
    (project_id, lot_id, tracking_code, buyer_full_name, buyer_ci, buyer_ci_normalized,
     buyer_phone, buyer_email, status, price_agreed, amount_due, amount_due_currency,
     currency, source, verified_by, confirmed_at)
  values
    (v_lot.project_id, v_lot.id, v_code, btrim(p_full_name), p_ci, private.normalize_ci(p_ci),
     private.normalize_phone_bo(p_phone), nullif(btrim(coalesce(p_email, '')), ''), 'confirmada',
     v_price, v_amount, v_project.currency, v_project.currency, 'oficina', v_actor, now())
  returning id into v_res_id;

  update public.lots set active_reservation_id = v_res_id where id = v_lot.id;

  v_ref := v_project.tracking_prefix || '-' || replace(v_mz_code, '-', '') || '-'
           || v_lot.number || '-' || private.gen_code(4);
  insert into public.payments
    (project_id, reservation_id, provider, reference_code, purpose, amount, currency,
     amount_bob, exchange_rate_used, status, verified_by, verified_at, rejection_note)
  values
    (v_lot.project_id, v_res_id, 'manual_qr', v_ref, 'reserva', v_amount, v_project.currency,
     case when v_project.currency = 'BOB' then v_amount else round(v_amount * v_rate, 2) end,
     v_rate, 'aprobado', v_actor, now(), p_note);

  perform private.audit('team', v_actor, null, 'lot.sold_offline', v_lot.project_id,
    'reservation', v_res_id,
    null, jsonb_build_object('lot_id', v_lot.id, 'monto', v_amount, 'nota', p_note));

  return jsonb_build_object('tracking_code', v_code, 'reservation_id', v_res_id);
end;
$$;

create or replace function public.admin_set_lots_blocked(p_lot_ids uuid[], p_blocked boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_actor uuid;
  v_count int;
begin
  v_actor := private.assert_admin();

  if p_blocked then
    update public.lots set status = 'no_disponible'
     where id = any(p_lot_ids) and status = 'disponible' and deleted_at is null;
  else
    update public.lots set status = 'disponible'
     where id = any(p_lot_ids) and status = 'no_disponible' and deleted_at is null;
  end if;
  get diagnostics v_count = row_count;

  perform private.audit('team', v_actor, null,
    case when p_blocked then 'lots.blocked' else 'lots.unblocked' end,
    (select project_id from public.lots where id = p_lot_ids[1]),
    'lots', null, null,
    jsonb_build_object('lot_ids', to_jsonb(p_lot_ids), 'afectados', v_count, 'nota', p_note));

  return jsonb_build_object('afectados', v_count);
end;
$$;

-- ============================================================================
-- Pricing + team + settings admin
-- ============================================================================
create or replace function public.bulk_update_lot_prices(p_manzana_id uuid, p_op jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_actor uuid;
  v_mz public.manzanas%rowtype;
  v_count int := 0;
  v_cat_id uuid;
begin
  v_actor := private.assert_admin();
  select * into v_mz from public.manzanas where id = p_manzana_id;
  if not found then raise exception 'MANZANA_NOT_FOUND'; end if;

  if p_op->>'mode' = 'set_category' then
    select id into v_cat_id from public.pricing_categories
    where project_id = v_mz.project_id and code = p_op->>'category_code';
    if v_cat_id is null then raise exception 'CATEGORY_NOT_FOUND'; end if;
    update public.lots set category_id = v_cat_id
     where manzana_id = p_manzana_id and deleted_at is null;
  elsif p_op->>'mode' = 'set_override' then
    update public.lots set price_override = (p_op->>'value')::numeric
     where manzana_id = p_manzana_id and deleted_at is null;
  elsif p_op->>'mode' = 'adjust_override_pct' then
    update public.lots
       set price_override = round(coalesce(price_override, public.lot_price(id))
                                  * (1 + (p_op->>'pct')::numeric / 100.0), 2)
     where manzana_id = p_manzana_id and deleted_at is null;
  elsif p_op->>'mode' = 'clear_override' then
    update public.lots set price_override = null
     where manzana_id = p_manzana_id and deleted_at is null;
  else
    raise exception 'INVALID_OP';
  end if;
  get diagnostics v_count = row_count;

  perform private.audit('team', v_actor, null, 'lots.bulk_price_update', v_mz.project_id,
    'manzana', p_manzana_id, null,
    jsonb_build_object('op', p_op, 'afectados', v_count));

  return jsonb_build_object('afectados', v_count);
end;
$$;

create or replace function public.set_team_member(p_user_id uuid, p_role public.team_role, p_is_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_actor uuid;
  v_before public.profiles%rowtype;
  v_admin_count int;
begin
  v_actor := private.assert_admin();

  select * into v_before from public.profiles where id = p_user_id for update;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;

  -- Last-admin protection.
  if v_before.role = 'admin' and (p_role <> 'admin' or not p_is_active) then
    select count(*) into v_admin_count from public.profiles
    where role = 'admin' and is_active and id <> p_user_id;
    if v_admin_count = 0 then raise exception 'LAST_ADMIN'; end if;
  end if;

  update public.profiles set role = p_role, is_active = p_is_active where id = p_user_id;

  perform private.audit('team', v_actor, null, 'profile.updated', null, 'profile', p_user_id,
    jsonb_build_object('role', v_before.role, 'is_active', v_before.is_active),
    jsonb_build_object('role', p_role, 'is_active', p_is_active));

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.update_setting(
  p_project_id uuid, p_key text, p_value jsonb, p_is_public boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_actor uuid;
  v_before jsonb;
begin
  v_actor := private.assert_admin();

  select value into v_before from public.settings
  where key = p_key and project_id is not distinct from p_project_id;

  insert into public.settings (project_id, key, value, is_public, updated_by)
  values (p_project_id, p_key, p_value, coalesce(p_is_public, false), v_actor)
  on conflict (project_id, key)
  do update set value = excluded.value,
                is_public = coalesce(p_is_public, public.settings.is_public),
                updated_by = excluded.updated_by,
                updated_at = now();

  perform private.audit('team', v_actor, null, 'setting.updated', p_project_id,
    'setting', null, jsonb_build_object('key', p_key, 'value', v_before),
    jsonb_build_object('key', p_key, 'value', p_value));

  return jsonb_build_object('ok', true);
end;
$$;

-- ============================================================================
-- Builder persistence + publish
-- ============================================================================
create or replace function private.ring_to_geom(p_ring jsonb)
returns extensions.geometry
language plpgsql
immutable
set search_path = extensions
as $$
declare
  v_points extensions.geometry[];
  v_pt jsonb;
  v_geom extensions.geometry;
begin
  for v_pt in select * from jsonb_array_elements(p_ring) loop
    v_points := array_append(v_points,
      extensions.st_makepoint((v_pt->>0)::float8, (v_pt->>1)::float8));
  end loop;
  -- Close the ring if the caller didn't.
  if not extensions.st_equals(v_points[1], v_points[array_length(v_points, 1)]) then
    v_points := array_append(v_points, v_points[1]);
  end if;
  v_geom := extensions.st_makepolygon(extensions.st_makeline(v_points));
  if not extensions.st_isvalid(v_geom) then
    raise exception 'INVALID_GEOMETRY';
  end if;
  return v_geom;
end;
$$;

create or replace function public.save_manzana(
  p_project_id uuid,
  p_code text,
  p_kind public.manzana_kind,
  p_sector text,
  p_ring jsonb,
  p_spec jsonb default null,
  p_expected_version int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_actor uuid;
  v_id uuid;
  v_version int;
begin
  v_actor := private.assert_admin();

  select id, version into v_id, v_version
  from public.manzanas where project_id = p_project_id and code = p_code;

  if v_id is null then
    insert into public.manzanas (project_id, code, kind, sector, geom, subdivision_spec, state)
    values (p_project_id, p_code, p_kind, p_sector, private.ring_to_geom(p_ring), p_spec, 'draft')
    returning id, version into v_id, v_version;
  else
    if p_expected_version is not null and p_expected_version <> v_version then
      raise exception 'VERSION_CONFLICT';
    end if;
    update public.manzanas
       set kind = p_kind, sector = p_sector, geom = private.ring_to_geom(p_ring),
           subdivision_spec = coalesce(p_spec, subdivision_spec),
           state = 'draft', version = version + 1
     where id = v_id
    returning version into v_version;
  end if;

  perform private.audit('team', v_actor, null, 'manzana.saved', p_project_id,
    'manzana', v_id, null, jsonb_build_object('code', p_code, 'version', v_version));

  return jsonb_build_object('id', v_id, 'version', v_version);
end;
$$;

-- Upserts a manzana's lots. Validates: valid polygons, containment in the manzana
-- (5 cm buffer), pairwise sibling overlap ≤ 0.05 m². Refuses to replace geometry
-- of any lot that is not 'disponible' or has reservation history.
create or replace function public.save_lots(
  p_manzana_id uuid,
  p_lots jsonb,
  p_replace_missing boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_actor uuid;
  v_mz public.manzanas%rowtype;
  v_item jsonb;
  v_geom extensions.geometry;
  v_numbers text[] := '{}';
  v_lot public.lots%rowtype;
  v_upserted int := 0;
  v_locked text[] := '{}';
  a record;
begin
  v_actor := private.assert_admin();

  select * into v_mz from public.manzanas where id = p_manzana_id;
  if not found then raise exception 'MANZANA_NOT_FOUND'; end if;
  if v_mz.geom is null then raise exception 'MANZANA_HAS_NO_GEOMETRY'; end if;

  create temp table tmp_new_lots (
    number text primary key,
    geom extensions.geometry,
    frontage_m numeric, depth_m numeric, area_m2 numeric,
    is_corner boolean, is_manual_geom boolean, edge_dims jsonb, needs_review boolean
  ) on commit drop;

  for v_item in select * from jsonb_array_elements(p_lots) loop
    v_geom := private.ring_to_geom(v_item->'ring');
    if not extensions.st_within(v_geom, extensions.st_buffer(v_mz.geom, 0.05)) then
      raise exception 'LOT_OUTSIDE_MANZANA: %', v_item->>'number';
    end if;
    insert into tmp_new_lots values (
      v_item->>'number', v_geom,
      (v_item->>'frontage_m')::numeric, (v_item->>'depth_m')::numeric,
      (v_item->>'area_m2')::numeric,
      coalesce((v_item->>'is_corner')::boolean, false),
      coalesce((v_item->>'is_manual_geom')::boolean, false),
      v_item->'edge_dims',
      coalesce((v_item->>'needs_review')::boolean, false)
    );
    v_numbers := array_append(v_numbers, v_item->>'number');
  end loop;

  -- Pairwise overlap among the submitted set.
  for a in
    select l1.number as n1, l2.number as n2
    from tmp_new_lots l1
    join tmp_new_lots l2 on l1.number < l2.number
      and l1.geom && l2.geom
      and extensions.st_area(extensions.st_intersection(l1.geom, l2.geom)) > 0.05
    limit 5
  loop
    raise exception 'LOTS_OVERLAP: % y %', a.n1, a.n2;
  end loop;

  -- Geometry-locked lots: not disponible, or any reservation history.
  select array_agg(l.number) into v_locked
  from public.lots l
  join tmp_new_lots t on t.number = l.number
  where l.manzana_id = p_manzana_id and l.deleted_at is null
    and not extensions.st_equals(l.geom, t.geom)
    and (l.status <> 'disponible'
         or exists (select 1 from public.reservations r where r.lot_id = l.id));
  if v_locked is not null and array_length(v_locked, 1) > 0 then
    raise exception 'LOTS_GEOMETRY_LOCKED: %', array_to_string(v_locked, ', ');
  end if;

  for a in select * from tmp_new_lots loop
    select * into v_lot from public.lots
    where manzana_id = p_manzana_id and number = a.number and deleted_at is null;
    if found then
      update public.lots
         set geom = a.geom, frontage_m = a.frontage_m, depth_m = a.depth_m,
             area_m2 = coalesce(a.area_m2, area_m2),
             is_corner = a.is_corner, is_manual_geom = a.is_manual_geom,
             edge_dims = a.edge_dims, needs_review = a.needs_review,
             state = 'draft', version = version + 1
       where id = v_lot.id;
    else
      insert into public.lots
        (project_id, manzana_id, number, geom, frontage_m, depth_m, area_m2,
         is_corner, is_manual_geom, edge_dims, needs_review, state)
      values
        (v_mz.project_id, p_manzana_id, a.number, a.geom, a.frontage_m, a.depth_m,
         coalesce(a.area_m2, round(extensions.st_area(a.geom)::numeric, 2)),
         a.is_corner, a.is_manual_geom, a.edge_dims, a.needs_review, 'draft');
    end if;
    v_upserted := v_upserted + 1;
  end loop;

  if p_replace_missing then
    -- Soft-delete lots not in the new set; hard-blocked if they have history.
    if exists (
      select 1 from public.lots l
      where l.manzana_id = p_manzana_id and l.deleted_at is null
        and not (l.number = any(v_numbers))
        and (l.status <> 'disponible'
             or exists (select 1 from public.reservations r where r.lot_id = l.id))
    ) then
      raise exception 'LOTS_GEOMETRY_LOCKED: no se pueden eliminar lotes con historial';
    end if;
    update public.lots set deleted_at = now(), state = 'draft'
     where manzana_id = p_manzana_id and deleted_at is null
       and not (number = any(v_numbers));
  end if;

  update public.manzanas set state = 'draft' where id = p_manzana_id;

  perform private.audit('team', v_actor, null, 'lots.saved', v_mz.project_id,
    'manzana', p_manzana_id, null,
    jsonb_build_object('cantidad', v_upserted, 'reemplazo', p_replace_missing));

  return jsonb_build_object('upserted', v_upserted);
end;
$$;

create or replace function public.save_map_elements(p_project_id uuid, p_elements jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_actor uuid;
  v_item jsonb;
  v_geom extensions.geometry;
  v_count int := 0;
  v_pts extensions.geometry[];
  v_pt jsonb;
begin
  v_actor := private.assert_admin();

  for v_item in select * from jsonb_array_elements(p_elements) loop
    if v_item ? 'ring' then
      v_geom := private.ring_to_geom(v_item->'ring');
    elsif v_item ? 'line' then
      v_pts := '{}';
      for v_pt in select * from jsonb_array_elements(v_item->'line') loop
        v_pts := array_append(v_pts,
          extensions.st_makepoint((v_pt->>0)::float8, (v_pt->>1)::float8));
      end loop;
      v_geom := extensions.st_makeline(v_pts);
    else
      raise exception 'ELEMENT_NEEDS_RING_OR_LINE';
    end if;

    if v_item ? 'id' then
      update public.map_elements
         set kind = (v_item->>'kind')::public.element_kind, name = v_item->>'name',
             geom = v_geom, props = coalesce(v_item->'props', '{}'), state = 'draft'
       where id = (v_item->>'id')::uuid and project_id = p_project_id;
    else
      insert into public.map_elements (project_id, kind, name, geom, props, state)
      values (p_project_id, (v_item->>'kind')::public.element_kind, v_item->>'name',
              v_geom, coalesce(v_item->'props', '{}'), 'draft');
    end if;
    v_count := v_count + 1;
  end loop;

  perform private.audit('team', v_actor, null, 'map_elements.saved', p_project_id,
    'project', p_project_id, null, jsonb_build_object('cantidad', v_count));

  return jsonb_build_object('saved', v_count);
end;
$$;

-- Validates the whole project, flips drafts to published, bumps geometry_version,
-- and returns the compact client snapshot (the route handler uploads it to Storage).
create or replace function public.publish_geometry(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_actor uuid;
  v_version int;
  v_pair record;
  v_snapshot jsonb;
  v_bbox extensions.box2d;
begin
  v_actor := private.assert_admin();

  -- Cross-manzana lot overlap check (GiST-assisted).
  for v_pair in
    select a.id as id_a, b.id as id_b
    from public.lots a
    join public.lots b on a.id < b.id
      and a.project_id = b.project_id
      and a.geom && b.geom
      and extensions.st_area(extensions.st_intersection(a.geom, b.geom)) > 0.05
    where a.project_id = p_project_id and a.deleted_at is null and b.deleted_at is null
    limit 1
  loop
    raise exception 'LOTS_OVERLAP_GLOBAL: % / %', v_pair.id_a, v_pair.id_b;
  end loop;

  update public.manzanas set state = 'published'
   where project_id = p_project_id and state = 'draft';
  update public.lots set state = 'published'
   where project_id = p_project_id and state = 'draft' and deleted_at is null;
  update public.map_elements set state = 'published'
   where project_id = p_project_id and state = 'draft';

  update public.projects
     set geometry_version = geometry_version + 1
   where id = p_project_id
  returning geometry_version into v_version;

  select extensions.st_extent(geom) into v_bbox
  from public.manzanas where project_id = p_project_id and geom is not null;

  select jsonb_build_object(
    'v', v_version,
    'bbox', jsonb_build_array(
      extensions.st_xmin(v_bbox), extensions.st_ymin(v_bbox),
      extensions.st_xmax(v_bbox), extensions.st_ymax(v_bbox)),
    'manzanas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'code', m.code, 'kind', m.kind, 'sector', m.sector,
        'needs_review', m.needs_review,
        'ring', (extensions.st_asgeojson(m.geom, 2)::jsonb)->'coordinates'->0
      ) order by m.code)
      from public.manzanas m
      where m.project_id = p_project_id and m.state = 'published' and m.geom is not null
    ), '[]'),
    'lots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'mz', l.manzana_id, 'n', l.number,
        'f', l.frontage_m, 'd', l.depth_m, 'a', l.area_m2, 'corner', l.is_corner,
        'ring', (extensions.st_asgeojson(l.geom, 2)::jsonb)->'coordinates'->0
      ) order by l.manzana_id, l.number)
      from public.lots l
      where l.project_id = p_project_id and l.state = 'published' and l.deleted_at is null
    ), '[]'),
    'elements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'kind', e.kind, 'name', e.name, 'props', e.props,
        'geojson', extensions.st_asgeojson(e.geom, 2)::jsonb
      ))
      from public.map_elements e
      where e.project_id = p_project_id and e.state = 'published'
    ), '[]')
  ) into v_snapshot;

  perform private.audit('team', v_actor, null, 'geometry.published', p_project_id,
    'project', p_project_id, null, jsonb_build_object('version', v_version));

  return v_snapshot;
end;
$$;

-- CSV import: applies staged rows to lots by (manzana_code, lot_number).
create or replace function public.apply_lot_import(p_batch_id uuid, p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_actor uuid;
  r record;
  v_lot_id uuid;
  v_cat_id uuid;
  v_updated int := 0;
  v_errors int := 0;
  v_warnings jsonb := '[]';
  v_computed numeric;
begin
  v_actor := private.assert_admin();

  for r in
    select * from private.lot_import_rows
    where batch_id = p_batch_id
    order by row_num
  loop
    v_lot_id := null;
    select l.id, l.computed_area_m2::numeric into v_lot_id, v_computed
    from public.lots l
    join public.manzanas m on m.id = l.manzana_id
    where m.project_id = p_project_id and m.code = r.manzana_code
      and l.number = r.lot_number and l.deleted_at is null;

    if v_lot_id is null then
      update private.lot_import_rows set error = 'lote no encontrado'
       where batch_id = p_batch_id and row_num = r.row_num;
      v_errors := v_errors + 1;
      continue;
    end if;

    v_cat_id := null;
    if r.category_code is not null then
      select id into v_cat_id from public.pricing_categories
      where project_id = p_project_id and code = r.category_code;
      if v_cat_id is null then
        update private.lot_import_rows set error = 'categoría no encontrada: ' || r.category_code
         where batch_id = p_batch_id and row_num = r.row_num;
        v_errors := v_errors + 1;
        continue;
      end if;
    end if;

    if r.area_m2 is not null and v_computed > 0
       and abs(r.area_m2 - v_computed) / v_computed > 0.03 then
      v_warnings := v_warnings || jsonb_build_object(
        'manzana', r.manzana_code, 'lote', r.lot_number,
        'area_csv', r.area_m2, 'area_geom', round(v_computed, 2));
    end if;

    update public.lots
       set frontage_m = coalesce(r.frontage_m, frontage_m),
           depth_m = coalesce(r.depth_m, depth_m),
           area_m2 = coalesce(r.area_m2, area_m2),
           category_id = coalesce(v_cat_id, category_id),
           price_override = coalesce(r.price_override, price_override)
     where id = v_lot_id;
    v_updated := v_updated + 1;
  end loop;

  perform private.audit('team', v_actor, null, 'lots.csv_import', p_project_id,
    'project', p_project_id, null,
    jsonb_build_object('batch', p_batch_id, 'actualizados', v_updated, 'errores', v_errors));

  return jsonb_build_object('actualizados', v_updated, 'errores', v_errors, 'advertencias', v_warnings);
end;
$$;

-- Staging insert for the CSV wizard (admin pushes parsed rows here, then applies).
create or replace function public.stage_lot_import(p_batch_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_actor uuid;
  v_count int := 0;
  v_item jsonb;
begin
  v_actor := private.assert_admin();
  delete from private.lot_import_rows where batch_id = p_batch_id;
  for v_item in select * from jsonb_array_elements(p_rows) loop
    insert into private.lot_import_rows
      (batch_id, row_num, manzana_code, lot_number, frontage_m, depth_m, area_m2,
       category_code, price_override)
    values
      (p_batch_id, v_count + 1, v_item->>'manzana', v_item->>'lote',
       nullif(v_item->>'frente', '')::numeric, nullif(v_item->>'fondo', '')::numeric,
       nullif(v_item->>'superficie', '')::numeric, nullif(v_item->>'categoria', ''),
       nullif(v_item->>'precio', '')::numeric);
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('staged', v_count);
end;
$$;

-- ============================================================================
-- Public read RPCs (anon-callable, zero PII)
-- ============================================================================
create or replace function public.get_map_manifest(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'project_id', p.id,
    'slug', p.slug,
    'name', p.name,
    'currency', p.currency,
    'geometry_version', p.geometry_version,
    'status_rev', p.status_rev
  )
  from public.projects p
  where p.slug = p_slug and p.status = 'activo';
$$;

create or replace function public.get_lot_statuses(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'status_rev', (select status_rev from public.projects where id = p_project_id),
    'server_now', now(),
    'lots', coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id, 'st', l.status,
      'priced', (public.lot_price(l.id) is not null),
      'price', public.lot_price(l.id))), '[]')
  )
  from public.lots l
  where l.project_id = p_project_id and l.state = 'published' and l.deleted_at is null;
$$;

grant execute on function public.get_map_manifest(text), public.get_lot_statuses(uuid)
to anon, authenticated, service_role;

-- Team RPCs: authenticated only (self-authorizing inside).
revoke execute on function
  public.approve_payment(uuid),
  public.reject_payment(uuid, public.rejection_reason_kind, text, boolean),
  public.attach_payment_on_behalf(uuid, text),
  public.admin_extend_hold(uuid, int),
  public.admin_cancel_reservation(uuid, text),
  public.admin_revert_sale(uuid, text),
  public.admin_reinstate_reservation(uuid, int),
  public.mark_sold_offline(uuid, text, text, text, text, numeric, text),
  public.admin_set_lots_blocked(uuid[], boolean, text),
  public.bulk_update_lot_prices(uuid, jsonb),
  public.set_team_member(uuid, public.team_role, boolean),
  public.update_setting(uuid, text, jsonb, boolean),
  public.save_manzana(uuid, text, public.manzana_kind, text, jsonb, jsonb, int),
  public.save_lots(uuid, jsonb, boolean),
  public.save_map_elements(uuid, jsonb),
  public.publish_geometry(uuid),
  public.apply_lot_import(uuid, uuid),
  public.stage_lot_import(uuid, jsonb)
from public, anon;

grant execute on function
  public.approve_payment(uuid),
  public.reject_payment(uuid, public.rejection_reason_kind, text, boolean),
  public.attach_payment_on_behalf(uuid, text),
  public.admin_extend_hold(uuid, int),
  public.admin_cancel_reservation(uuid, text),
  public.admin_revert_sale(uuid, text),
  public.admin_reinstate_reservation(uuid, int),
  public.mark_sold_offline(uuid, text, text, text, text, numeric, text),
  public.admin_set_lots_blocked(uuid[], boolean, text),
  public.bulk_update_lot_prices(uuid, jsonb),
  public.set_team_member(uuid, public.team_role, boolean),
  public.update_setting(uuid, text, jsonb, boolean),
  public.save_manzana(uuid, text, public.manzana_kind, text, jsonb, jsonb, int),
  public.save_lots(uuid, jsonb, boolean),
  public.save_map_elements(uuid, jsonb),
  public.publish_geometry(uuid),
  public.apply_lot_import(uuid, uuid),
  public.stage_lot_import(uuid, jsonb)
to authenticated, service_role;
