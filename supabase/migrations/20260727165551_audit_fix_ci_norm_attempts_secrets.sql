-- 5. CI NORMALIZATION (media): dashes were not stripped, so "7896541-1E" and
--    "78965411E" became different identities — the CI cap was evadable and the
--    buyer's own cancel could fail on a CI_MISMATCH.
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

-- 6. FAILED ATTEMPTS NEVER PERSISTED (media): log_attempt followed by RAISE is
--    rolled back with the transaction, so rate limiting was blind to failures.
--    The route handler records failures out-of-band after catching the error.
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

-- 7. SECRETS READABLE BY THE WHOLE TEAM (baja): settings_team_read exposed
--    internal_cron_secret to every ventas user. Restrict secret keys to admins.
drop policy if exists settings_team_read on public.settings;
create policy settings_team_read on public.settings
  for select to authenticated
  using (
    private.is_team()
    and (key <> 'internal_cron_secret' or private.is_admin())
  );
