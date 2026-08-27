-- Un interesado dejaba su nombre y su celular y NADIE se enteraba.
--
-- La pantalla le promete «el vendedor y la oficina verán tu contacto y te
-- llamarán», y mercado_consultar solo hacía INSERT en market_inquiries: sin
-- notificación, sin correo, sin nada. La única forma de enterarse era que
-- alguien de la oficina abriera esa tabla por su cuenta. En una vidriera donde
-- se le pide el teléfono a un desconocido, eso es perder la venta y quedar mal.
--
-- Ahora la consulta entra al mismo riel que el resto: notificación para el
-- equipo, con el lote, el precio pedido y el contacto que dejó, y correo si
-- hay destinatarios configurados.
create or replace function public.mercado_consultar(
  p_listing_id uuid,
  p_nombre text,
  p_telefono text,
  p_mensaje text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_ml public.market_listings%rowtype;
  v_tel text;
  v_id uuid;
  v_res public.reservations%rowtype;
  v_mz text; v_lote text; v_proy text;
begin
  if btrim(coalesce(p_nombre, '')) = '' then raise exception 'NAME_REQUIRED'; end if;
  v_tel := private.normalize_phone_bo(p_telefono);
  if coalesce(v_tel, '') = '' then raise exception 'BUYER_PHONE_REQUIRED'; end if;

  select * into v_ml from public.market_listings where id = p_listing_id and status = 'activa';
  if not found then raise exception 'LISTING_NOT_FOUND'; end if;

  if (select count(*) from public.market_inquiries
       where listing_id = p_listing_id and created_at > now() - interval '1 day') >= 50 then
    raise exception 'DEMASIADAS_CONSULTAS';
  end if;

  insert into public.market_inquiries (listing_id, nombre, telefono, mensaje)
  values (p_listing_id, btrim(p_nombre), v_tel, nullif(btrim(coalesce(p_mensaje, '')), ''))
  returning id into v_id;

  -- A quién le interesa: el lote publicado y su dueño.
  select r.* into v_res from public.reservations r where r.id = v_ml.reservation_id;
  select m.code, l.number, p.name into v_mz, v_lote, v_proy
    from public.lots l
    join public.manzanas m on m.id = l.manzana_id
    join public.projects p on p.id = l.project_id
   where l.id = v_res.lot_id;

  perform private.notify(
    v_res.project_id,
    'consulta_mercado'::notification_type,
    'alta',
    format('Consulta por el lote %s-%s (%s)', coalesce(v_mz, '—'), coalesce(v_lote, '—'), coalesce(v_proy, '')),
    format('%s (%s) preguntó por el lote que %s publicó en %s. Pide %s.%s',
           btrim(p_nombre), v_tel, coalesce(v_res.buyer_full_name, 'el vendedor'),
           coalesce(v_proy, 'el mercado'),
           to_char(v_ml.asking_price_bob, 'FM999G999G999D00'),
           coalesce(' Mensaje: ' || nullif(btrim(coalesce(p_mensaje, '')), ''), '')),
    'market_listing', p_listing_id,
    jsonb_build_object(
      'inquiry_id', v_id, 'listing_id', p_listing_id,
      'interesado', btrim(p_nombre), 'telefono', v_tel,
      'mensaje', nullif(btrim(coalesce(p_mensaje, '')), ''),
      'tracking_code', v_res.tracking_code,
      'vendedor', v_res.buyer_full_name, 'vendedor_telefono', v_res.buyer_phone,
      'manzana', v_mz, 'lote', v_lote, 'proyecto', v_proy,
      'precio_pedido', v_ml.asking_price_bob),
    true);

  return jsonb_build_object('inquiry_id', v_id);
end;
$$;
