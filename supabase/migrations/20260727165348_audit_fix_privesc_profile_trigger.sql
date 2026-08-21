-- 1. PRIVILEGE ESCALATION (alta): the profile trigger trusted
--    raw_user_meta_data.role, which any self-signup can set. Anyone with the
--    anon key could POST /auth/v1/signup with {"role":"admin"} and land an
--    active admin profile — full buyer PII + payment approval.
--    Role now comes ONLY from app_metadata (service_role-writable), and only
--    invited users get a profile at all.
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
