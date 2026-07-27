-- Fixes from the adversarial bug audit (2026-07-28). New migration: the earlier
-- files are already applied in production and must not be edited.

-- ============================================================================
-- 1. PRIVILEGE ESCALATION (alta): the profile trigger trusted
--    raw_user_meta_data.role, which any self-signup can set. Anyone with the
--    anon key could POST /auth/v1/signup with {"role":"admin"} and land an
--    active admin profile — full buyer PII + payment approval.
--    Role now comes ONLY from app_metadata (service_role-writable), and only
--    invited users get a profile at all.
-- ============================================================================
create or replace function private.tg_create_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Self-signups get no team profile whatsoever.
  if new.invited_at is null then
    return new;
  end if;
  insert into public.profiles (id, full_name, role, is_active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    case when new.raw_app_meta_data->>'team_role' = 'admin' then 'admin'::public.team_role
         else 'ventas'::public.team_role end,
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Remediate any profile that could have been created by a self-signup.
update public.profiles p
   set is_active = false
  from auth.users u
 where u.id = p.id and u.invited_at is null;

-- ============================================================================
-- 2. CHECK-THEN-INSERT RACE (alta): 50 concurrent requests with the same CI all
--    counted 0 active reservations and passed, freezing 50 lots despite
--    max_active_per_ci = 1. Advisory xact locks serialize same-identity
--    requests; the loser waits, then sees the committed reservation.
-- ============================================================================
create or replace function private.check_reservation_limits(
  p_project_id uuid,
  p_ci_normalized text,
  p_phone text,
  p_ip_hash text
)
returns void
language plpgsql
set search_path = public, private
as $$
declare
  v_max_per_ci int;
begin
  -- Fixed acquisition order (ci → phone → ip) so concurrent callers can't deadlock.
  perform pg_advisory_xact_lock(hashtext('resv_ci'), hashtext(p_ci_normalized));
  perform pg_advisory_xact_lock(hashtext('resv_phone'), hashtext(p_phone));
  if p_ip_hash is not null then
    perform pg_advisory_xact_lock(hashtext('resv_ip'), hashtext(p_ip_hash));
  end if;

  v_max_per_ci := coalesce(private.setting_int(p_project_id, 'max_active_per_ci', 1), 1);

  if (select count(*) from public.reservations
      where buyer_ci_normalized = p_ci_normalized
        and status in ('pendiente_pago', 'en_verificacion', 'rechazo_reintento')) >= v_max_per_ci then
    raise exception 'CI_LIMIT_REACHED';
  end if;

  if p_ip_hash is not null and (
      select count(*) from private.reservation_attempts
      where ip_hash = p_ip_hash and action = 'create'
        and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'RATE_LIMITED';
  end if;

  if p_ip_hash is not null and (
      select count(*) from private.reservation_attempts
      where ip_hash = p_ip_hash and action = 'create'
        and created_at > now() - interval '24 hours') >= 15 then
    raise exception 'RATE_LIMITED';
  end if;

  if (select count(*) from private.reservation_attempts
      where phone = p_phone and action = 'create'
        and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'RATE_LIMITED';
  end if;

  if (select count(*) from private.reservation_attempts
      where ci_normalized = p_ci_normalized and action = 'create'
        and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'RATE_LIMITED';
  end if;
end;
$$;

-- ============================================================================
-- 3. SETTINGS VALIDATION (alta): update_setting accepted any jsonb for any key.
--    A malformed notification_emails aborted every create_reservation; a bad
--    expiry_grace_minutes silently halted the expiry cron forever; is_public
--    could be flipped on internal_cron_secret, exposing it to anon.
-- ============================================================================

-- Cast-safe reader: one bad row can never abort a reservation or a cron run.
create or replace function private.setting_int(p_project_id uuid, p_key text, p_default int)
returns int
language plpgsql
stable
set search_path = public, private
as $$
declare
  v jsonb;
begin
  v := private.get_setting(p_project_id, p_key);
  if v is null or jsonb_typeof(v) <> 'number' then
    return p_default;
  end if;
  return (v #>> '{}')::int;
exception when others then
  return p_default;
end;
$$;

create or replace function private.setting_numeric(p_project_id uuid, p_key text, p_default numeric)
returns numeric
language plpgsql
stable
set search_path = public, private
as $$
declare
  v jsonb;
  n numeric;
begin
  v := private.get_setting(p_project_id, p_key);
  if v is null or jsonb_typeof(v) <> 'number' then
    return p_default;
  end if;
  n := (v #>> '{}')::numeric;
  if n <= 0 then
    return p_default;
  end if;
  return n;
exception when others then
  return p_default;
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
  v_type text;
  v_num numeric;
begin
  v_actor := private.assert_admin();
  v_type := jsonb_typeof(p_value);

  -- Whitelist + shape/range validation. Unknown keys are rejected outright.
  case p_key
    when 'hold_hours', 'retry_hours' then
      if v_type <> 'number' then raise exception 'SETTING_INVALID'; end if;
      v_num := (p_value #>> '{}')::numeric;
      if v_num < 1 or v_num > 8760 then raise exception 'SETTING_INVALID'; end if;
    when 'expiry_grace_minutes' then
      if v_type <> 'number' then raise exception 'SETTING_INVALID'; end if;
      v_num := (p_value #>> '{}')::numeric;
      if v_num < 0 or v_num > 1440 then raise exception 'SETTING_INVALID'; end if;
    when 'max_active_per_ci' then
      if v_type <> 'number' then raise exception 'SETTING_INVALID'; end if;
      v_num := (p_value #>> '{}')::numeric;
      if v_num < 1 or v_num > 100 then raise exception 'SETTING_INVALID'; end if;
    when 'exchange_rate_bob_per_usd' then
      if v_type <> 'number' then raise exception 'SETTING_INVALID'; end if;
      v_num := (p_value #>> '{}')::numeric;
      if v_num <= 0 or v_num > 1000 then raise exception 'SETTING_INVALID'; end if;
    when 'captcha_enabled' then
      if v_type <> 'boolean' then raise exception 'SETTING_INVALID'; end if;
    when 'notification_emails' then
      if v_type <> 'array' then raise exception 'SETTING_INVALID'; end if;
      if exists (
        select 1 from jsonb_array_elements(p_value) e
        where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
      ) then raise exception 'SETTING_INVALID'; end if;
    when 'reserve_amount' then
      if v_type <> 'object' then raise exception 'SETTING_INVALID'; end if;
      if coalesce(p_value->>'type', '') not in ('fijo', 'porcentaje', 'total') then
        raise exception 'SETTING_INVALID';
      end if;
      if p_value->>'type' <> 'total' then
        if jsonb_typeof(p_value->'value') <> 'number' then raise exception 'SETTING_INVALID'; end if;
        v_num := (p_value->>'value')::numeric;
        if v_num <= 0 then raise exception 'SETTING_INVALID'; end if;
        if p_value->>'type' = 'porcentaje' and v_num > 100 then raise exception 'SETTING_INVALID'; end if;
      end if;
      if p_value ? 'currency' and coalesce(p_value->>'currency', '') not in ('USD', 'BOB') then
        raise exception 'SETTING_INVALID';
      end if;
    when 'payment_instructions', 'whatsapp_templates' then
      if v_type <> 'object' then raise exception 'SETTING_INVALID'; end if;
    when 'terms_version', 'payment_provider' then
      if v_type <> 'string' then raise exception 'SETTING_INVALID'; end if;
    when 'app_base_url' then
      if v_type not in ('string', 'null') then raise exception 'SETTING_INVALID'; end if;
    when 'internal_cron_secret' then
      if v_type <> 'string' then raise exception 'SETTING_INVALID'; end if;
    else
      raise exception 'SETTING_UNKNOWN';
  end case;

  -- Secrets can never be published to anon.
  if coalesce(p_is_public, false) and p_key in ('internal_cron_secret', 'notification_emails',
                                                'payment_instructions') then
    raise exception 'SETTING_NOT_PUBLISHABLE';
  end if;

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
    'setting', null, jsonb_build_object('key', p_key, 'value',
      case when p_key = 'internal_cron_secret' then '"[oculto]"'::jsonb else v_before end),
    jsonb_build_object('key', p_key, 'value',
      case when p_key = 'internal_cron_secret' then '"[oculto]"'::jsonb else p_value end));

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.update_setting(uuid, text, jsonb, boolean) from public, anon;
grant execute on function public.update_setting(uuid, text, jsonb, boolean)
  to authenticated, service_role;

-- Defense in depth: a scalar notification_emails must never abort a reservation.
create or replace function private.notify(
  p_project_id uuid,
  p_type public.notification_type,
  p_priority text,
  p_title text,
  p_body text,
  p_entity_type text,
  p_entity_id uuid,
  p_payload jsonb,
  p_team_email boolean default false,
  p_buyer_email text default null,
  p_buyer_template text default null
)
returns uuid
language plpgsql
set search_path = public, private
as $$
declare
  v_id uuid;
  v_recipient text;
  v_emails jsonb;
begin
  insert into public.notifications (project_id, type, priority, title, body, entity_type, entity_id, payload)
  values (p_project_id, p_type, p_priority, p_title, p_body, p_entity_type, p_entity_id, coalesce(p_payload, '{}'))
  returning id into v_id;

  if p_team_email then
    v_emails := private.get_setting(p_project_id, 'notification_emails');
    if v_emails is not null and jsonb_typeof(v_emails) = 'array' then
      for v_recipient in select jsonb_array_elements_text(v_emails) loop
        insert into public.notification_outbox (notification_id, channel, recipient, template, payload)
        values (v_id, 'email', v_recipient, 'team_' || p_type::text, coalesce(p_payload, '{}'));
      end loop;
    end if;
  end if;

  if p_buyer_email is not null and p_buyer_template is not null then
    insert into public.notification_outbox (notification_id, channel, recipient, template, payload)
    values (v_id, 'email', p_buyer_email, p_buyer_template, coalesce(p_payload, '{}'));
  end if;

  return v_id;
end;
$$;

-- Cron must survive a malformed grace setting.
create or replace function private.expire_due_reservations(p_limit int default 500)
returns int
language plpgsql
set search_path = public, private
as $$
declare
  v_n int := 0;
  r record;
begin
  for r in
    select res.id, res.lot_id, res.project_id, res.tracking_code, res.status,
           res.buyer_full_name, res.buyer_email
      from public.reservations res
     where (
        (res.status = 'pendiente_pago' and res.hold_expires_at is not null
         and res.hold_expires_at
             + make_interval(mins => private.setting_int(res.project_id, 'expiry_grace_minutes', 10))
             <= now())
        or
        (res.status = 'rechazo_reintento' and res.retry_expires_at is not null
         and res.retry_expires_at
             + make_interval(mins => private.setting_int(res.project_id, 'expiry_grace_minutes', 10))
             <= now())
     )
     order by coalesce(res.hold_expires_at, res.retry_expires_at)
     limit p_limit
     for update skip locked
  loop
    update public.reservations
       set status = 'expirada', expired_at = now(),
           hold_expires_at = null, retry_expires_at = null
     where id = r.id and status in ('pendiente_pago', 'rechazo_reintento');
    if found then
      update public.payments set status = 'cancelado'
       where reservation_id = r.id and status in ('pendiente', 'comprobante_subido');

      update public.lots
         set status = 'disponible', active_reservation_id = null
       where id = r.lot_id and active_reservation_id = r.id and status = 'reservado';

      perform private.notify(
        r.project_id, 'reserva_expirada', 'baja', 'Reserva expirada',
        format('%s — %s', r.tracking_code, r.buyer_full_name),
        'reservation', r.id,
        jsonb_build_object('tracking_code', r.tracking_code),
        p_buyer_email => r.buyer_email,
        p_buyer_template => 'buyer_reserva_expirada');

      perform private.audit('cron', null, null, 'reservation.expired', r.project_id,
        'reservation', r.id, jsonb_build_object('status', r.status),
        jsonb_build_object('status', 'expirada'));

      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- ============================================================================
-- 4. SPOOFABLE PUBLIC REALTIME (alta): the lots topic was non-private, so anyone
--    with the anon key could broadcast fake 'vendido' for every lot. Make the
--    topic private: clients may RECEIVE (SELECT policy) but never PUBLISH
--    (no INSERT policy).
-- ============================================================================
create or replace function private.tg_broadcast_lot_status()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_rev bigint;
begin
  update public.projects
     set status_rev = status_rev + 1
   where id = new.project_id
  returning status_rev into v_rev;

  perform realtime.send(
    jsonb_build_object('lot_id', new.id, 'status', new.status, 'status_rev', v_rev),
    'lot_status',
    'project:' || new.project_id || ':lots',
    true  -- private topic: receive requires the policy below, publishing is impossible
  );
  return new;
end;
$$;

create policy project_broadcast_read on realtime.messages
  for select to anon, authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and split_part((select realtime.topic()), ':', 1) = 'project'
  );

-- ============================================================================
-- 5. CI NORMALIZATION (media): dashes were not stripped, so "7896541-1E" and
--    "78965411E" became different identities — the CI cap was evadable and the
--    buyer's own cancel could fail on a CI_MISMATCH.
-- ============================================================================
create or replace function private.normalize_ci(p_ci text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text;
begin
  v := upper(regexp_replace(coalesce(p_ci, ''), '[.\s-]', '', 'g'));
  if v !~ '^[0-9]{5,10}[A-Z0-9]{0,2}$' then
    raise exception 'INVALID_CI';
  end if;
  return v;
end;
$$;

-- Backfill existing rows so old reservations stay matchable by their owners.
update public.reservations
   set buyer_ci_normalized = upper(regexp_replace(buyer_ci_normalized, '[.\s-]', '', 'g'))
 where buyer_ci_normalized ~ '[.\s-]';

-- ============================================================================
-- 6. FAILED ATTEMPTS NEVER PERSISTED (media): log_attempt followed by RAISE is
--    rolled back with the transaction, so rate limiting was blind to failures.
--    The route handler now records failures out-of-band after catching.
-- ============================================================================
create or replace function public.log_reservation_failure(
  p_ip_hash text, p_ci text, p_phone text, p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  insert into private.reservation_attempts (ip_hash, ci_normalized, phone, action, success, reason)
  values (p_ip_hash, left(coalesce(p_ci, ''), 20), left(coalesce(p_phone, ''), 20),
          'create', false, left(coalesce(p_reason, ''), 60));
end;
$$;

revoke execute on function public.log_reservation_failure(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.log_reservation_failure(text, text, text, text) to service_role;

-- ============================================================================
-- 7. SECRETS READABLE BY THE WHOLE TEAM (baja): settings_team_read exposed
--    internal_cron_secret to every ventas user. Restrict secret keys to admins.
-- ============================================================================
drop policy if exists settings_team_read on public.settings;
create policy settings_team_read on public.settings
  for select to authenticated
  using (
    private.is_team()
    and (key <> 'internal_cron_secret' or private.is_admin())
  );

-- ============================================================================
-- 8. DESTRUCTIVE BUILDER SAVE (alta, server-side guard): save_lots with
--    p_replace_missing and an empty payload soft-deleted an entire manzana when
--    the client's lot query was still in flight or had failed.
-- ============================================================================
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
  v_live int;
  a record;
begin
  v_actor := private.assert_admin();

  select * into v_mz from public.manzanas where id = p_manzana_id;
  if not found then raise exception 'MANZANA_NOT_FOUND'; end if;
  if v_mz.geom is null then raise exception 'MANZANA_HAS_NO_GEOMETRY'; end if;

  -- Never let an empty payload wipe a populated manzana (client load race).
  if p_replace_missing and jsonb_array_length(coalesce(p_lots, '[]'::jsonb)) = 0 then
    select count(*) into v_live from public.lots
    where manzana_id = p_manzana_id and deleted_at is null;
    if v_live > 0 then
      raise exception 'EMPTY_REPLACE_BLOCKED';
    end if;
  end if;

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

revoke execute on function public.save_lots(uuid, jsonb, boolean) from public, anon;
grant execute on function public.save_lots(uuid, jsonb, boolean) to authenticated, service_role;
