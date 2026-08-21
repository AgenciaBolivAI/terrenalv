-- 2. CHECK-THEN-INSERT RACE (alta): 50 concurrent requests with the same CI all
--    counted 0 active reservations and passed, freezing 50 lots despite
--    max_active_per_ci = 1. Advisory xact locks serialize same-identity
--    requests; the loser waits, then sees the committed reservation.
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
