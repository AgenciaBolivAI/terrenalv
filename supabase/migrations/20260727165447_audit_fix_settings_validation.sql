-- 3. SETTINGS VALIDATION (alta): update_setting accepted any jsonb for any key.
--    A malformed notification_emails aborted every create_reservation; a bad
--    expiry_grace_minutes silently halted the expiry cron forever; is_public
--    could be flipped on internal_cron_secret, exposing it to anon.

-- Cast-safe readers: one bad row can never abort a reservation or a cron run.
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
