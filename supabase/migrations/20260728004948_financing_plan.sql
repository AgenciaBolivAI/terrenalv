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
    when 'financing_plan' then
      if v_type <> 'object' then raise exception 'SETTING_INVALID'; end if;
      if jsonb_typeof(p_value->'enabled') <> 'boolean' then raise exception 'SETTING_INVALID'; end if;
      if coalesce(p_value->>'down_payment_type', '') not in ('porcentaje', 'fijo') then
        raise exception 'SETTING_INVALID';
      end if;
      if jsonb_typeof(p_value->'down_payment_value') <> 'number' then
        raise exception 'SETTING_INVALID';
      end if;
      v_num := (p_value->>'down_payment_value')::numeric;
      if v_num <= 0 then raise exception 'SETTING_INVALID'; end if;
      if p_value->>'down_payment_type' = 'porcentaje' and v_num > 100 then
        raise exception 'SETTING_INVALID';
      end if;
      if jsonb_typeof(p_value->'months') <> 'number' then raise exception 'SETTING_INVALID'; end if;
      v_num := (p_value->>'months')::numeric;
      if v_num < 1 or v_num > 600 or v_num <> trunc(v_num) then
        raise exception 'SETTING_INVALID';
      end if;
      if p_value ? 'annual_interest_pct' then
        if jsonb_typeof(p_value->'annual_interest_pct') <> 'number' then
          raise exception 'SETTING_INVALID';
        end if;
        v_num := (p_value->>'annual_interest_pct')::numeric;
        if v_num < 0 or v_num > 100 then raise exception 'SETTING_INVALID'; end if;
      end if;
      if p_value ? 'note' and jsonb_typeof(p_value->'note') not in ('string', 'null') then
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

insert into public.settings (project_id, key, value, is_public)
values (null, 'financing_plan', jsonb_build_object(
          'enabled', true,
          'down_payment_type', 'porcentaje',
          'down_payment_value', 30,
          'months', 36,
          'annual_interest_pct', 0,
          'note', 'Plan referencial. El plan definitivo se confirma en oficina.'
        ), true)
on conflict (project_id, key) do nothing;
