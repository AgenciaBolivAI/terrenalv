-- Internal tables and helper functions (schema `private`, invisible to PostgREST).

create table private.reservation_attempts (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  ip_hash        text,
  ci_normalized  text,
  phone          text,
  action         text not null,
  success        boolean not null,
  reason         text
);

create index reservation_attempts_ip_idx on private.reservation_attempts (ip_hash, created_at);
create index reservation_attempts_ci_idx on private.reservation_attempts (ci_normalized, created_at);
create index reservation_attempts_phone_idx on private.reservation_attempts (phone, created_at);

-- Staging for CSV/Excel bulk import of lot attributes.
create table private.lot_import_rows (
  batch_id        uuid not null,
  row_num         int not null,
  manzana_code    text,
  lot_number      text,
  frontage_m      numeric(8,2),
  depth_m         numeric(8,2),
  area_m2         numeric(10,2),
  category_code   text,
  price_override  numeric(12,2),
  error           text,
  created_at      timestamptz not null default now(),
  primary key (batch_id, row_num)
);

-- Role predicates. SECURITY DEFINER so they can read profiles regardless of caller;
-- the (select auth.uid()) wrapper makes Postgres cache the lookup per statement.
create or replace function private.is_team()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active
  );
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active and p.role = 'admin'
  );
$$;

revoke execute on function private.is_team(), private.is_admin() from public, anon, authenticated;
grant execute on function private.is_team(), private.is_admin() to anon, authenticated;

-- Setting resolution: project override → global default (project_id null) → NULL.
create or replace function private.get_setting(p_project_id uuid, p_key text)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select value from public.settings where project_id = p_project_id and key = p_key),
    (select value from public.settings where project_id is null and key = p_key)
  );
$$;

-- CI: strip dots/spaces, uppercase. Accepts complemento suffixes like '-1E'.
create or replace function private.normalize_ci(p_ci text)
returns text
language plpgsql
immutable
as $$
declare
  v text;
begin
  v := upper(regexp_replace(coalesce(p_ci, ''), '[.\s]', '', 'g'));
  if v !~ '^[0-9]{5,10}(-?[A-Z0-9]{1,2})?$' then
    raise exception 'INVALID_CI';
  end if;
  return v;
end;
$$;

-- Bolivian mobile: 8 digits starting 6/7, normalized to E.164 +591########.
create or replace function private.normalize_phone_bo(p_phone text)
returns text
language plpgsql
immutable
as $$
declare
  v text;
begin
  v := regexp_replace(coalesce(p_phone, ''), '[\s\-().]', '', 'g');
  if v ~ '^591[67][0-9]{7}$' then
    v := '+' || v;
  elsif v ~ '^[67][0-9]{7}$' then
    v := '+591' || v;
  end if;
  if v !~ '^\+591[67][0-9]{7}$' then
    raise exception 'INVALID_PHONE';
  end if;
  return v;
end;
$$;

-- Crypto-strong codes from an unambiguous alphabet (no 0/O/1/I/L) — readable over
-- WhatsApp or the phone. 31^8 ≈ 8.5e11 combinations.
create or replace function private.gen_code(p_len int)
returns text
language plpgsql
volatile
set search_path = extensions
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  bytes bytea;
  result text := '';
  i int;
begin
  bytes := extensions.gen_random_bytes(p_len);
  for i in 0 .. p_len - 1 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % 31) + 1, 1);
  end loop;
  return result;
end;
$$;

create or replace function private.gen_tracking_code(p_prefix text)
returns text
language sql
volatile
as $$
  select p_prefix || '-' || private.gen_code(4) || '-' || private.gen_code(4);
$$;

-- In-DB rate limits + one-active-per-CI. Runs even if the route-handler shim is buggy.
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
  v_max_per_ci := coalesce((private.get_setting(p_project_id, 'max_active_per_ci'))::int, 1);

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

create or replace function private.log_attempt(
  p_ip_hash text, p_ci text, p_phone text, p_action text, p_success boolean, p_reason text
)
returns void
language sql
set search_path = private
as $$
  insert into private.reservation_attempts (ip_hash, ci_normalized, phone, action, success, reason)
  values (p_ip_hash, p_ci, p_phone, p_action, p_success, p_reason);
$$;

-- Shared notifier: inserts the team feed row and fans out outbox deliveries in the
-- SAME transaction (outbox pattern). Team recipients come from settings.notification_emails.
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
begin
  insert into public.notifications (project_id, type, priority, title, body, entity_type, entity_id, payload)
  values (p_project_id, p_type, p_priority, p_title, p_body, p_entity_type, p_entity_id, coalesce(p_payload, '{}'))
  returning id into v_id;

  if p_team_email then
    for v_recipient in
      select jsonb_array_elements_text(coalesce(private.get_setting(p_project_id, 'notification_emails'), '[]'))
    loop
      insert into public.notification_outbox (notification_id, channel, recipient, template, payload)
      values (v_id, 'email', v_recipient, 'team_' || p_type::text, coalesce(p_payload, '{}'));
    end loop;
  end if;

  if p_buyer_email is not null and p_buyer_template is not null then
    insert into public.notification_outbox (notification_id, channel, recipient, template, payload)
    values (v_id, 'email', p_buyer_email, p_buyer_template, coalesce(p_payload, '{}'));
  end if;

  return v_id;
end;
$$;

create or replace function private.audit(
  p_actor_type public.actor_type,
  p_actor_id uuid,
  p_actor_label text,
  p_action text,
  p_project_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_before jsonb,
  p_after jsonb,
  p_ip_hash text default null
)
returns void
language sql
set search_path = public
as $$
  insert into public.audit_log
    (actor_type, actor_id, actor_label, action, project_id, entity_type, entity_id, before, after, ip_hash)
  values
    (p_actor_type, p_actor_id, p_actor_label, p_action, p_project_id, p_entity_type, p_entity_id,
     p_before, p_after, p_ip_hash);
$$;

create or replace function private.prune_internal()
returns void
language sql
set search_path = private
as $$
  delete from private.reservation_attempts where created_at < now() - interval '7 days';
$$;
