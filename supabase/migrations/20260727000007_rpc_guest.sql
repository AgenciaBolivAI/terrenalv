-- Guest-facing RPCs. SECURITY DEFINER, executable ONLY by service_role: guests reach
-- them through Next.js route handlers that supply the real client IP hash (and CAPTCHA
-- when enabled). Atomicity lives 100% in these functions — the route is a thin shim.
-- Every raised message is a stable error code the UI maps to Spanish copy.

-- ============================================================================
-- create_reservation: the atomic lot flip + intent-at-creation payment row.
-- ============================================================================
create or replace function public.create_reservation(
  p_lot_id uuid,
  p_full_name text,
  p_ci text,
  p_phone text,
  p_email text default null,
  p_terms_version text default null,
  p_ip_hash text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_ci text;
  v_phone text;
  v_lot public.lots%rowtype;
  v_mz_code text;
  v_project public.projects%rowtype;
  v_price numeric(12,2);
  v_amount_due numeric(12,2);
  v_amount_due_cur char(3);
  v_amount_bob numeric(12,2);
  v_rate numeric(10,4);
  v_reserve jsonb;
  v_hold_h int;
  v_expires timestamptz;
  v_code text;
  v_ref text;
  v_res_id uuid;
  v_pay_id uuid;
  v_try int := 0;
begin
  -- 1. Normalize + validate (raise typed codes).
  v_ci := private.normalize_ci(p_ci);
  v_phone := private.normalize_phone_bo(p_phone);
  if length(btrim(coalesce(p_full_name, ''))) < 5 then
    raise exception 'INVALID_NAME';
  end if;
  if p_email is not null and btrim(p_email) <> '' and p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL';
  end if;

  -- 2. Rate limits + one-active-per-CI (in-DB, independent of the shim).
  select l.* into v_lot from public.lots l where l.id = p_lot_id and l.deleted_at is null;
  if not found then
    raise exception 'LOT_NOT_AVAILABLE';
  end if;
  perform private.check_reservation_limits(v_lot.project_id, v_ci, v_phone, p_ip_hash);

  select * into v_project from public.projects where id = v_lot.project_id;
  if v_project.status <> 'activo' then
    raise exception 'LOT_NOT_AVAILABLE';
  end if;

  -- 3. Price must exist before we take the lot (unpriced inventory is browsable, not reservable).
  v_price := public.lot_price(v_lot.id);
  if v_price is null or v_price <= 0 then
    perform private.log_attempt(p_ip_hash, v_ci, v_phone, 'create', false, 'lot_not_priced');
    raise exception 'LOT_NOT_PRICED';
  end if;

  -- 4. THE ATOMIC FLIP. Under READ COMMITTED the losing concurrent tap re-evaluates
  -- the WHERE against the committed row and matches 0 rows — deterministic, no window.
  update public.lots
     set status = 'reservado'
   where id = p_lot_id
     and status = 'disponible'
     and state = 'published'
     and deleted_at is null
  returning * into v_lot;
  if not found then
    perform private.log_attempt(p_ip_hash, v_ci, v_phone, 'create', false, 'lot_not_available');
    raise exception 'LOT_NOT_AVAILABLE';
  end if;

  select code into v_mz_code from public.manzanas where id = v_lot.manzana_id;

  -- 5. Seña (amount due now) from settings; freeze the full price separately.
  v_reserve := coalesce(private.get_setting(v_lot.project_id, 'reserve_amount'),
                        '{"type":"total"}'::jsonb);
  v_rate := coalesce((private.get_setting(v_lot.project_id, 'exchange_rate_bob_per_usd'))::numeric, 6.96);
  if v_reserve->>'type' = 'fijo' then
    v_amount_due := (v_reserve->>'value')::numeric;
    v_amount_due_cur := coalesce(v_reserve->>'currency', 'BOB');
  elsif v_reserve->>'type' = 'porcentaje' then
    v_amount_due := round(v_price * (v_reserve->>'value')::numeric / 100.0, 2);
    v_amount_due_cur := v_project.currency;
  else
    v_amount_due := v_price;
    v_amount_due_cur := v_project.currency;
  end if;
  v_amount_bob := case when v_amount_due_cur = 'BOB' then v_amount_due
                       else round(v_amount_due * v_rate, 2) end;

  v_hold_h := coalesce((private.get_setting(v_lot.project_id, 'hold_hours'))::int, 48);
  v_expires := now() + make_interval(hours => v_hold_h);

  -- 6. Tracking code + reservation insert (retry only on code collision).
  loop
    v_try := v_try + 1;
    v_code := private.gen_tracking_code(v_project.tracking_prefix);
    begin
      insert into public.reservations
        (project_id, lot_id, tracking_code, buyer_full_name, buyer_ci, buyer_ci_normalized,
         buyer_phone, buyer_email, status, hold_expires_at, price_agreed, amount_due,
         amount_due_currency, currency, terms_version, terms_accepted_at, source, client_meta)
      values
        (v_lot.project_id, v_lot.id, v_code, btrim(p_full_name), p_ci, v_ci,
         v_phone, nullif(btrim(coalesce(p_email, '')), ''), 'pendiente_pago', v_expires,
         v_price, v_amount_due, v_amount_due_cur, v_project.currency,
         p_terms_version, case when p_terms_version is not null then now() end,
         'web',
         jsonb_build_object('ip_hash', p_ip_hash, 'user_agent', left(coalesce(p_user_agent, ''), 300)))
      returning id into v_res_id;
      exit;
    exception when unique_violation then
      if v_try >= 3 or sqlerrm not like '%tracking_code%' then
        raise;
      end if;
    end;
  end loop;

  update public.lots set active_reservation_id = v_res_id where id = v_lot.id;

  -- 7. Payment intent row, same transaction: the glosa reference exists before the buyer pays.
  v_try := 0;
  loop
    v_try := v_try + 1;
    v_ref := v_project.tracking_prefix || '-' || replace(v_mz_code, '-', '') || '-'
             || v_lot.number || '-' || private.gen_code(4);
    begin
      insert into public.payments
        (project_id, reservation_id, provider, reference_code, purpose,
         amount, currency, amount_bob, exchange_rate_used)
      values
        (v_lot.project_id, v_res_id, 'manual_qr', v_ref, 'reserva',
         v_amount_due, v_amount_due_cur, v_amount_bob, v_rate)
      returning id into v_pay_id;
      exit;
    exception when unique_violation then
      if v_try >= 3 then raise; end if;
    end;
  end loop;

  -- 8. Side effects, all-or-nothing with the reservation itself.
  perform private.notify(
    v_lot.project_id, 'nueva_reserva', 'normal',
    'Nueva reserva',
    format('Lote %s, Manzana %s — %s', v_lot.number, v_mz_code, btrim(p_full_name)),
    'reservation', v_res_id,
    jsonb_build_object('tracking_code', v_code, 'manzana', v_mz_code, 'lote', v_lot.number,
                       'monto_bob', v_amount_bob),
    p_team_email => true,
    p_buyer_email => nullif(btrim(coalesce(p_email, '')), ''),
    p_buyer_template => 'buyer_reserva_creada');

  perform private.audit('guest', null, v_code, 'reservation.created', v_lot.project_id,
    'reservation', v_res_id,
    null,
    jsonb_build_object('lot_id', v_lot.id, 'expires', v_expires, 'price_agreed', v_price,
                       'amount_due', v_amount_due, 'currency', v_amount_due_cur),
    p_ip_hash);

  perform private.log_attempt(p_ip_hash, v_ci, v_phone, 'create', true, null);

  return jsonb_build_object(
    'tracking_code', v_code,
    'reservation_id', v_res_id,
    'hold_expires_at', v_expires,
    'server_now', now(),
    'price_agreed', v_price,
    'currency', v_project.currency,
    'amount_due', v_amount_due,
    'amount_due_currency', v_amount_due_cur,
    'amount_bob', v_amount_bob,
    'exchange_rate', v_rate,
    'reference_code', v_ref,
    'payment_instructions', private.get_setting(v_lot.project_id, 'payment_instructions')
  );
end;
$$;

-- ============================================================================
-- get_reservation_status: sanitized projection for the tracking page.
-- The tracking code is the capability; page is WhatsApp-forwardable by design.
-- ============================================================================
create or replace function public.get_reservation_status(
  p_tracking_code text,
  p_ip_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_res public.reservations%rowtype;
  v_lot public.lots%rowtype;
  v_mz_code text;
  v_pay record;
  v_grace int;
begin
  -- Generous: the tracking page polls while awaiting verification (~2/min max);
  -- this only stops scripted enumeration.
  if p_ip_hash is not null and (
      select count(*) from private.reservation_attempts
      where ip_hash = p_ip_hash and action = 'status_lookup'
        and created_at > now() - interval '1 hour') >= 200 then
    raise exception 'RATE_LIMITED';
  end if;
  perform private.log_attempt(p_ip_hash, null, null, 'status_lookup', true, null);

  select * into v_res from public.reservations
  where tracking_code = upper(btrim(p_tracking_code));
  if not found then
    raise exception 'RESERVATION_NOT_FOUND';
  end if;

  select * into v_lot from public.lots where id = v_res.lot_id;
  select code into v_mz_code from public.manzanas where id = v_lot.manzana_id;

  select p.status, p.reference_code, p.amount, p.currency, p.amount_bob,
         p.rejection_reason, p.rejection_note, p.proof_submitted_at
    into v_pay
  from public.payments p
  where p.reservation_id = v_res.id and p.purpose = 'reserva'
  order by p.created_at desc
  limit 1;

  v_grace := coalesce((private.get_setting(v_res.project_id, 'expiry_grace_minutes'))::int, 10);

  return jsonb_build_object(
    'tracking_code', v_res.tracking_code,
    'status', v_res.status,
    'server_now', now(),
    'hold_expires_at', v_res.hold_expires_at,
    'retry_expires_at', v_res.retry_expires_at,
    'grace_minutes', v_grace,
    'buyer_display', split_part(v_res.buyer_full_name, ' ', 1) || ' ' ||
                     left(split_part(v_res.buyer_full_name, ' ', 2), 1) || '.',
    'manzana', v_mz_code,
    'lote', v_lot.number,
    'sector', (select sector from public.manzanas where id = v_lot.manzana_id),
    'area_m2', v_lot.area_m2,
    'frontage_m', v_lot.frontage_m,
    'depth_m', v_lot.depth_m,
    'price_agreed', v_res.price_agreed,
    'currency', v_res.currency,
    'amount_due', v_res.amount_due,
    'amount_due_currency', v_res.amount_due_currency,
    'confirmed_at', v_res.confirmed_at,
    'cancel_reason', v_res.cancel_reason,
    'payment', case when v_pay is null then null else jsonb_build_object(
      'status', v_pay.status,
      'reference_code', v_pay.reference_code,
      'amount', v_pay.amount,
      'currency', v_pay.currency,
      'amount_bob', v_pay.amount_bob,
      'rejection_reason', v_pay.rejection_reason,
      'rejection_note', v_pay.rejection_note,
      'proof_submitted_at', v_pay.proof_submitted_at
    ) end,
    'payment_instructions', case
      when v_res.status in ('pendiente_pago', 'rechazo_reintento')
      then private.get_setting(v_res.project_id, 'payment_instructions')
    end
  );
end;
$$;

-- ============================================================================
-- submit_payment_proof: flips to en_verificacion and PAUSES the countdown.
-- Locks the reservation row — the expiry cron uses SKIP LOCKED, so whichever
-- transaction wins the race decides, never both.
-- ============================================================================
create or replace function public.submit_payment_proof(
  p_tracking_code text,
  p_storage_path text,
  p_sha256 text,
  p_ip_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_res public.reservations%rowtype;
  v_pay public.payments%rowtype;
  v_grace int;
  v_deadline timestamptz;
  v_dup_count int;
  v_mz_code text;
  v_lot_number text;
begin
  select * into v_res from public.reservations
  where tracking_code = upper(btrim(p_tracking_code))
  for update;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND';
  end if;

  v_grace := coalesce((private.get_setting(v_res.project_id, 'expiry_grace_minutes'))::int, 10);
  if v_res.status = 'pendiente_pago' then
    v_deadline := v_res.hold_expires_at + make_interval(mins => v_grace);
  elsif v_res.status = 'rechazo_reintento' then
    v_deadline := v_res.retry_expires_at + make_interval(mins => v_grace);
  else
    raise exception 'RESERVATION_NOT_PENDING';
  end if;
  if now() > v_deadline then
    raise exception 'RESERVATION_EXPIRED';
  end if;

  -- The path is server-chosen at signed-URL mint time; re-verify shape + existence.
  if p_storage_path !~ ('^' || v_res.id || '/[a-z0-9-]+\.(jpg|jpeg|png|webp|pdf)$') then
    raise exception 'INVALID_PROOF_PATH';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'payment-proofs' and name = p_storage_path
  ) then
    raise exception 'PROOF_NOT_UPLOADED';
  end if;

  select * into v_pay from public.payments
  where reservation_id = v_res.id and purpose = 'reserva'
  order by created_at desc limit 1
  for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  select count(*) into v_dup_count from public.payments
  where proof_sha256 = p_sha256 and id <> v_pay.id and p_sha256 is not null;

  update public.payments
     set status = 'comprobante_subido',
         proof_storage_path = p_storage_path,
         proof_sha256 = p_sha256,
         proof_submitted_at = now(),
         rejection_reason = null,
         rejection_note = null
   where id = v_pay.id;

  -- Pause the clock while the team reviews.
  update public.reservations
     set status = 'en_verificacion',
         hold_expires_at = null,
         retry_expires_at = null
   where id = v_res.id;

  select m.code, l.number into v_mz_code, v_lot_number
  from public.lots l join public.manzanas m on m.id = l.manzana_id
  where l.id = v_res.lot_id;

  perform private.notify(
    v_res.project_id, 'comprobante_subido', 'alta',
    'Comprobante subido',
    format('Lote %s, Manzana %s — %s (Bs %s)', v_lot_number, v_mz_code,
           v_res.buyer_full_name, v_pay.amount_bob),
    'reservation', v_res.id,
    jsonb_build_object('tracking_code', v_res.tracking_code, 'manzana', v_mz_code,
                       'lote', v_lot_number, 'monto_bob', v_pay.amount_bob,
                       'payment_id', v_pay.id, 'posible_duplicado', v_dup_count > 0),
    p_team_email => true);

  perform private.audit('guest', null, v_res.tracking_code, 'payment.proof_submitted',
    v_res.project_id, 'payment', v_pay.id,
    jsonb_build_object('status', v_pay.status, 'proof', v_pay.proof_storage_path),
    jsonb_build_object('status', 'comprobante_subido', 'proof', p_storage_path,
                       'sha256', p_sha256, 'posible_duplicado', v_dup_count > 0),
    p_ip_hash);

  perform private.log_attempt(p_ip_hash, v_res.buyer_ci_normalized, v_res.buyer_phone,
    'proof_upload', true, null);

  return jsonb_build_object('status', 'en_verificacion', 'server_now', now());
end;
$$;

-- ============================================================================
-- cancel_reservation: buyer self-cancel. Requires code AND matching CI —
-- the forwardable tracking link alone must not be able to kill a reservation.
-- ============================================================================
create or replace function public.cancel_reservation(
  p_tracking_code text,
  p_ci text,
  p_ip_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_res public.reservations%rowtype;
begin
  select * into v_res from public.reservations
  where tracking_code = upper(btrim(p_tracking_code))
  for update;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND';
  end if;
  if v_res.buyer_ci_normalized <> private.normalize_ci(p_ci) then
    raise exception 'CI_MISMATCH';
  end if;
  if v_res.status not in ('pendiente_pago', 'en_verificacion', 'rechazo_reintento') then
    raise exception 'RESERVATION_NOT_ACTIVE';
  end if;

  update public.reservations
     set status = 'cancelada', cancelled_at = now(), cancel_reason = 'cancelada_por_comprador',
         hold_expires_at = null, retry_expires_at = null
   where id = v_res.id;

  update public.payments
     set status = 'cancelado'
   where reservation_id = v_res.id and status in ('pendiente', 'comprobante_subido');

  update public.lots
     set status = 'disponible', active_reservation_id = null
   where id = v_res.lot_id and active_reservation_id = v_res.id and status = 'reservado';

  perform private.notify(
    v_res.project_id, 'reserva_cancelada', 'baja',
    'Reserva cancelada por el comprador',
    format('%s — %s', v_res.tracking_code, v_res.buyer_full_name),
    'reservation', v_res.id,
    jsonb_build_object('tracking_code', v_res.tracking_code));

  perform private.audit('guest', null, v_res.tracking_code, 'reservation.cancelled',
    v_res.project_id, 'reservation', v_res.id,
    jsonb_build_object('status', v_res.status), jsonb_build_object('status', 'cancelada'), p_ip_hash);

  return jsonb_build_object('status', 'cancelada', 'server_now', now());
end;
$$;

-- Guest RPCs are service_role-only: if anon could call them directly, p_ip_hash would
-- be client-supplied (spoofable) and CAPTCHA unenforceable.
revoke execute on function
  public.create_reservation(uuid, text, text, text, text, text, text, text),
  public.get_reservation_status(text, text),
  public.submit_payment_proof(text, text, text, text),
  public.cancel_reservation(text, text, text)
from public, anon, authenticated;

grant execute on function
  public.create_reservation(uuid, text, text, text, text, text, text, text),
  public.get_reservation_status(text, text),
  public.submit_payment_proof(text, text, text, text),
  public.cancel_reservation(text, text, text)
to service_role;
