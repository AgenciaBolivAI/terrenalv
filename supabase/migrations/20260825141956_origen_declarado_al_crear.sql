-- El origen deja de deducirse: se escribe al crear la venta.
--
-- La deducción («nació confirmada, entonces fue directa») acierta hoy, pero es
-- frágil: cualquier cambio en cómo se confirma una venta la haría mentir en
-- silencio. Para las ventas que ya existen se sigue deduciendo — no se puede
-- inventar un hecho hacia atrás — y la vista distingue una cosa de la otra con
-- `origen_declarado`.

create or replace function public.mark_sold_offline(
  p_lot_id uuid, p_full_name text, p_ci text, p_phone text,
  p_email text default null, p_amount numeric default null, p_note text default null,
  p_provider public.payment_provider_kind default 'manual_qr'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $function$
declare
  v_actor uuid; v_lot public.lots%rowtype; v_project public.projects%rowtype;
  v_mz_code text; v_price numeric(12,2); v_rate numeric(10,4); v_amount numeric(12,2);
  v_code text; v_ref text; v_res_id uuid; v_email text;
begin
  v_actor := private.assert_admin();
  v_email := private.exigir_correo(p_email);

  update public.lots set status = 'vendido'
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
     currency, source, verified_by, confirmed_at, client_meta)
  values
    (v_lot.project_id, v_lot.id, v_code, btrim(p_full_name), p_ci, private.normalize_ci(p_ci),
     private.normalize_phone_bo(p_phone), v_email, 'confirmada',
     v_price, v_amount, v_project.currency, v_project.currency, 'oficina', v_actor, now(),
     jsonb_build_object('origen', 'oficina_directa'))
  returning id into v_res_id;

  update public.lots set active_reservation_id = v_res_id where id = v_lot.id;

  v_ref := v_project.tracking_prefix || '-' || replace(v_mz_code, '-', '') || '-'
           || v_lot.number || '-' || private.gen_code(4);
  insert into public.payments
    (project_id, reservation_id, provider, reference_code, purpose, amount, currency,
     amount_bob, exchange_rate_used, status, verified_by, verified_at, rejection_note)
  values
    (v_lot.project_id, v_res_id, coalesce(p_provider, 'manual_qr'), v_ref, 'reserva',
     v_amount, v_project.currency,
     case when v_project.currency = 'BOB' then v_amount else round(v_amount * v_rate, 2) end,
     v_rate, 'aprobado', v_actor, now(), p_note);

  perform private.audit('team', v_actor, null, 'lot.sold_offline', v_lot.project_id,
    'reservation', v_res_id, null,
    jsonb_build_object('lot_id', v_lot.id, 'monto', v_amount, 'origen', 'oficina_directa',
                       'forma_de_pago', coalesce(p_provider, 'manual_qr'), 'nota', p_note));

  return jsonb_build_object('tracking_code', v_code, 'reservation_id', v_res_id);
end;
$function$;

grant execute on function public.mark_sold_offline(
  uuid, text, text, text, text, numeric, text, public.payment_provider_kind)
  to authenticated, service_role;

-- La reserva de oficina también se declara.
create or replace function public.admin_reserve_offline(
  p_lot_id uuid, p_full_name text, p_ci text, p_phone text,
  p_email text default null, p_hours integer default null, p_note text default null,
  p_provider public.payment_provider_kind default 'manual_qr'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $function$
declare
  v_actor uuid; v_lot public.lots%rowtype; v_project public.projects%rowtype;
  v_mz_code text; v_price numeric(12,2); v_reserve jsonb; v_rate numeric(10,4);
  v_amount_due numeric(12,2); v_amount_due_cur text; v_amount_bob numeric(12,2);
  v_hold_h int; v_expires timestamptz; v_code text; v_ref text; v_res_id uuid;
  v_ci text; v_phone text; v_email text; v_try int := 0;
begin
  v_actor := private.assert_admin();

  if btrim(coalesce(p_full_name, '')) = '' then raise exception 'BUYER_NAME_REQUIRED'; end if;
  v_ci := private.normalize_ci(p_ci);
  if coalesce(v_ci, '') = '' then raise exception 'BUYER_CI_REQUIRED'; end if;
  v_phone := private.normalize_phone_bo(p_phone);
  if coalesce(v_phone, '') = '' then raise exception 'BUYER_PHONE_REQUIRED'; end if;
  v_email := private.exigir_correo(p_email);

  update public.lots set status = 'reservado'
   where id = p_lot_id and status = 'disponible' and deleted_at is null
  returning * into v_lot;
  if not found then raise exception 'LOT_NOT_AVAILABLE'; end if;

  select * into v_project from public.projects where id = v_lot.project_id;
  select code into v_mz_code from public.manzanas where id = v_lot.manzana_id;

  v_price := public.lot_price(v_lot.id);
  if v_price is null or v_price <= 0 then raise exception 'LOT_NOT_PRICED'; end if;

  v_reserve := coalesce(private.get_setting(v_lot.project_id, 'reserve_amount'), '{"type":"total"}'::jsonb);
  v_rate := coalesce((private.get_setting(v_lot.project_id, 'exchange_rate_bob_per_usd'))::numeric, 6.96);
  if v_reserve->>'type' = 'fijo' then
    v_amount_due := (v_reserve->>'value')::numeric;
    v_amount_due_cur := coalesce(v_reserve->>'currency', 'BOB');
  elsif v_reserve->>'type' = 'porcentaje' then
    v_amount_due := round(v_price * (v_reserve->>'value')::numeric / 100.0, 2);
    v_amount_due_cur := v_project.currency;
  else
    v_amount_due := v_price; v_amount_due_cur := v_project.currency;
  end if;
  v_amount_bob := case when v_amount_due_cur = 'BOB' then v_amount_due
                       else round(v_amount_due * v_rate, 2) end;

  v_hold_h := coalesce(p_hours, (private.get_setting(v_lot.project_id, 'hold_hours'))::int, 48);
  if v_hold_h < 1 or v_hold_h > 720 then raise exception 'INVALID_HOLD_HOURS'; end if;
  v_expires := now() + make_interval(hours => v_hold_h);

  loop
    v_try := v_try + 1;
    v_code := private.gen_tracking_code(v_project.tracking_prefix);
    begin
      insert into public.reservations
        (project_id, lot_id, tracking_code, buyer_full_name, buyer_ci, buyer_ci_normalized,
         buyer_phone, buyer_email, status, hold_expires_at, price_agreed, amount_due,
         amount_due_currency, currency, source, client_meta)
      values
        (v_lot.project_id, v_lot.id, v_code, btrim(p_full_name), p_ci, v_ci,
         v_phone, v_email, 'pendiente_pago', v_expires,
         v_price, v_amount_due, v_amount_due_cur, v_project.currency, 'oficina',
         jsonb_build_object('origen', 'oficina_reserva'))
      returning id into v_res_id;
      exit;
    exception when unique_violation then
      if v_try >= 3 or sqlerrm not like '%tracking_code%' then raise; end if;
    end;
  end loop;

  update public.lots set active_reservation_id = v_res_id where id = v_lot.id;

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
        (v_lot.project_id, v_res_id, coalesce(p_provider, 'manual_qr'), v_ref, 'reserva',
         v_amount_due, v_amount_due_cur, v_amount_bob, v_rate);
      exit;
    exception when unique_violation then
      if v_try >= 3 or sqlerrm not like '%reference_code%' then raise; end if;
    end;
  end loop;

  perform private.audit('team', v_actor, null, 'lot.reserved_offline', v_lot.project_id,
    'reservation', v_res_id, null,
    jsonb_build_object('lot_id', v_lot.id, 'manzana', v_mz_code, 'lote', v_lot.number,
      'sena', v_amount_due, 'moneda', v_amount_due_cur, 'origen', 'oficina_reserva',
      'forma_de_pago', coalesce(p_provider, 'manual_qr'), 'vence', v_expires, 'nota', p_note));

  return jsonb_build_object('tracking_code', v_code, 'reservation_id', v_res_id,
    'amount_due', v_amount_due, 'amount_due_currency', v_amount_due_cur,
    'hold_expires_at', v_expires, 'reference_code', v_ref);
end;
$function$;

grant execute on function public.admin_reserve_offline(
  uuid, text, text, text, text, integer, text, public.payment_provider_kind)
  to authenticated, service_role;
