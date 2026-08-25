-- La venta directa de oficina también dice cómo se pagó.
--
-- Igual que admin_reserve_offline, tenía 'manual_qr' escrito a mano — y esta es
-- peor, porque crea el pago YA APROBADO: entra derecho al libro mayor con la
-- vía equivocada, sin que nadie lo revise.
--
-- Además el correo pasa a ser obligatorio: es por donde le llega al comprador
-- su reserva y sus recibos, y sin él la única vía de contacto es un celular
-- tecleado a mano.
drop function if exists public.mark_sold_offline(uuid, text, text, text, text, numeric, text);

create function public.mark_sold_offline(
  p_lot_id uuid,
  p_full_name text,
  p_ci text,
  p_phone text,
  p_email text default null,
  p_amount numeric default null,
  p_note text default null,
  p_provider public.payment_provider_kind default 'manual_qr'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $function$
declare
  v_actor uuid;
  v_lot public.lots%rowtype;
  v_project public.projects%rowtype;
  v_mz_code text;
  v_price numeric(12,2);
  v_rate numeric(10,4);
  v_amount numeric(12,2);
  v_code text;
  v_ref text;
  v_res_id uuid;
  v_email text;
begin
  v_actor := private.assert_admin();

  v_email := lower(nullif(btrim(coalesce(p_email, '')), ''));
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' then
    raise exception 'BUYER_EMAIL_REQUIRED';
  end if;

  update public.lots
     set status = 'vendido'
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
     currency, source, verified_by, confirmed_at)
  values
    (v_lot.project_id, v_lot.id, v_code, btrim(p_full_name), p_ci, private.normalize_ci(p_ci),
     private.normalize_phone_bo(p_phone), v_email, 'confirmada',
     v_price, v_amount, v_project.currency, v_project.currency, 'oficina', v_actor, now())
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
    'reservation', v_res_id,
    null, jsonb_build_object('lot_id', v_lot.id, 'monto', v_amount,
                             'forma_de_pago', coalesce(p_provider, 'manual_qr'), 'nota', p_note));

  return jsonb_build_object('tracking_code', v_code, 'reservation_id', v_res_id);
end;
$function$;

revoke execute on function public.mark_sold_offline(
  uuid, text, text, text, text, numeric, text, public.payment_provider_kind) from public, anon;
grant execute on function public.mark_sold_offline(
  uuid, text, text, text, text, numeric, text, public.payment_provider_kind)
  to authenticated, service_role;

-- Y el mismo requisito en la reserva de oficina.
create or replace function private.exigir_correo(p_email text)
returns text
language plpgsql
immutable
as $$
declare v text;
begin
  v := lower(nullif(btrim(coalesce(p_email, '')), ''));
  if v is null or v !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' then
    raise exception 'BUYER_EMAIL_REQUIRED';
  end if;
  return v;
end;
$$;

grant execute on function private.exigir_correo(text) to anon, authenticated, service_role;
