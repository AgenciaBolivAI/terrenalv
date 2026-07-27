-- Scheduled jobs: reservation expiry (every minute), outbox delivery ping,
-- nightly prune. All run inside Postgres — they survive Vercel entirely.

-- Auto-release expired holds. FOR UPDATE SKIP LOCKED: never blocks on a row a
-- human (or the proof-upload RPC) is touching right now; the guarded re-check
-- under lock decides the race deterministically.
create or replace function private.expire_due_reservations(p_limit int default 500)
returns int
language plpgsql
set search_path = public, private
as $$
declare
  v_n int := 0;
  r record;
  v_grace int;
begin
  for r in
    select res.id, res.lot_id, res.project_id, res.tracking_code, res.status,
           res.buyer_full_name, res.buyer_email
      from public.reservations res
     where (
        (res.status = 'pendiente_pago' and res.hold_expires_at is not null
         and res.hold_expires_at + make_interval(mins =>
               coalesce((private.get_setting(res.project_id, 'expiry_grace_minutes'))::int, 10))
             <= now())
        or
        (res.status = 'rechazo_reintento' and res.retry_expires_at is not null
         and res.retry_expires_at + make_interval(mins =>
               coalesce((private.get_setting(res.project_id, 'expiry_grace_minutes'))::int, 10))
             <= now())
     )
     order by coalesce(res.hold_expires_at, res.retry_expires_at)
     limit p_limit
     for update skip locked
  loop
    -- Re-check under lock: the proof-upload RPC may have won the race.
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

-- Outbox drain trigger: when pending deliveries exist, ping the app's internal
-- delivery route (the app sends via Resend). No-op until app_base_url is configured.
create or replace function private.ping_outbox_delivery()
returns void
language plpgsql
set search_path = public, private, extensions
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (select 1 from public.notification_outbox
                 where status = 'pendiente' and attempts < 3) then
    return;
  end if;
  v_url := private.get_setting(null, 'app_base_url') #>> '{}';
  v_secret := private.get_setting(null, 'internal_cron_secret') #>> '{}';
  if v_url is null or v_url = '' then
    return;
  end if;
  perform net.http_post(
    url := v_url || '/api/internal/deliver-outbox',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret,
                                  'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 8000
  );
end;
$$;

do $$
begin
  begin
    perform cron.unschedule('expire_reservations');
  exception when others then null;
  end;
  begin
    perform cron.unschedule('deliver_outbox');
  exception when others then null;
  end;
  begin
    perform cron.unschedule('prune_internal');
  exception when others then null;
  end;
end;
$$;

select cron.schedule('expire_reservations', '* * * * *',
  $$select private.expire_due_reservations(500)$$);

select cron.schedule('deliver_outbox', '* * * * *',
  $$select private.ping_outbox_delivery()$$);

select cron.schedule('prune_internal', '15 4 * * *',
  $$select private.prune_internal()$$);
