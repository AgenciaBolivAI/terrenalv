-- Corregir los datos de CUALQUIER reserva, esté como esté.
--
-- admin_editar_venta solo acepta ventas confirmadas, así que una reserva
-- vencida con el teléfono mal tecleado no se podía arreglar — y es
-- justamente el caso en que hace falta: el comprador aparece al día
-- siguiente, hay que reactivarle la reserva y de paso corregirle el dato que
-- estaba mal.
create or replace function public.admin_editar_reserva(
  p_reservation_id uuid,
  p_full_name text default null,
  p_ci text default null,
  p_phone text default null,
  p_email text default null,
  p_price numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid; v_res public.reservations%rowtype; v_antes jsonb; v_correo text;
begin
  v_actor := private.assert_accounting();

  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;

  v_antes := jsonb_build_object(
    'nombre', v_res.buyer_full_name, 'ci', v_res.buyer_ci, 'tel', v_res.buyer_phone,
    'correo', v_res.buyer_email, 'precio', v_res.price_agreed, 'estado', v_res.status);

  if p_full_name is not null and btrim(p_full_name) = '' then
    raise exception 'BUYER_NAME_REQUIRED';
  end if;
  if p_price is not null then
    if p_price <= 0 then raise exception 'INVALID_AMOUNT'; end if;
    -- No se puede bajar el precio por debajo de lo ya cobrado: dejaría un
    -- saldo negativo y una venta que "pagó de más".
    if p_price < private.capital_pagado(p_reservation_id) - 0.01 then
      raise exception 'PRECIO_MENOR_A_LO_PAGADO'
        using detail = format('ya pagó %s', private.capital_pagado(p_reservation_id));
    end if;
  end if;
  if p_email is not null and btrim(p_email) <> '' then
    v_correo := private.exigir_correo(p_email);
  end if;

  update public.reservations
     set buyer_full_name = coalesce(nullif(btrim(p_full_name), ''), buyer_full_name),
         buyer_ci = coalesce(nullif(btrim(p_ci), ''), buyer_ci),
         buyer_ci_normalized = case when nullif(btrim(p_ci), '') is null
                                    then buyer_ci_normalized
                                    else private.normalize_ci(p_ci) end,
         buyer_phone = case when nullif(btrim(p_phone), '') is null
                            then buyer_phone
                            else private.normalize_phone_bo(p_phone) end,
         buyer_email = case when p_email is null then buyer_email else v_correo end,
         price_agreed = coalesce(p_price, price_agreed),
         updated_at = now()
   where id = p_reservation_id;

  perform private.audit('team', v_actor, null, 'reserva.editada', v_res.project_id,
    'reservation', p_reservation_id, v_antes,
    jsonb_build_object('nombre', p_full_name, 'ci', p_ci, 'tel', p_phone,
                       'correo', p_email, 'precio', p_price));

  return jsonb_build_object('ok', true);
end;
$fn$;

revoke execute on function public.admin_editar_reserva(uuid, text, text, text, text, numeric)
  from public, anon;
grant execute on function public.admin_editar_reserva(uuid, text, text, text, text, numeric)
  to authenticated, service_role;

-- ---- Reactivar acepta también reservas cuyo lote ya está tomado: avisa con
--      un error claro en vez de fallar con «LOT_NOT_AVAILABLE» a secas.
create or replace function public.admin_reinstate_reservation(
  p_reservation_id uuid, p_hours int default 24
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid; v_res public.reservations%rowtype; v_ocupa uuid;
begin
  v_actor := private.assert_team();

  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if v_res.status not in ('expirada', 'cancelada') then
    raise exception 'RESERVATION_NOT_REINSTATABLE';
  end if;
  -- Una reserva que se cedió por traspaso no se reactiva: su lote tiene dueño
  -- nuevo y su plata ya viajó.
  if v_res.client_meta ? 'traspasada_a' then
    raise exception 'RESERVA_TRASPASADA'
      using detail = 'Esta reserva se cedió por traspaso; su lote ya tiene otro comprador.';
  end if;

  select r.id into v_ocupa from public.reservations r
   where r.lot_id = v_res.lot_id and r.id <> v_res.id
     and r.status in ('pendiente_pago','en_verificacion','rechazo_reintento','confirmada')
   limit 1;
  if v_ocupa is not null then
    raise exception 'LOTE_YA_TOMADO'
      using detail = 'Otro comprador tomó ese lote. Reactivá sobre otro lote o traspasá.';
  end if;

  update public.lots
     set status = 'reservado', active_reservation_id = v_res.id
   where id = v_res.lot_id and deleted_at is null;
  if not found then raise exception 'LOT_NOT_AVAILABLE'; end if;

  update public.reservations
     set status = 'pendiente_pago',
         hold_expires_at = now() + make_interval(hours => coalesce(p_hours, 24)),
         retry_expires_at = null,
         expired_at = null, cancelled_at = null, cancel_reason = null,
         updated_at = now()
   where id = v_res.id;

  -- La seña que se había dado por perdida vuelve a estar en juego.
  update public.payments set status = 'pendiente'
   where reservation_id = v_res.id and purpose = 'reserva' and status = 'cancelado';

  perform private.audit('team', v_actor, null, 'reservation.reinstated',
    v_res.project_id, 'reservation', v_res.id,
    jsonb_build_object('estado', v_res.status),
    jsonb_build_object('estado', 'pendiente_pago', 'horas', p_hours));

  return jsonb_build_object('status', 'pendiente_pago',
                            'hasta', now() + make_interval(hours => coalesce(p_hours, 24)));
end;
$fn$;
