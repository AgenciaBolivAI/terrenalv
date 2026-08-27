-- La reserva que se creó y cuyo código el comprador nunca vio.
--
-- create_reservation confirma la transacción —marca el lote 'reservado', crea
-- la reserva y su pago pendiente— y recién después devuelve el jsonb con el
-- código. Si esa respuesta se pierde (se corta el internet, el navegador móvil
-- mata la pestaña al cambiar de app para abrir el banco), el comprador lee
-- «Sin conexión» y se queda sin código, mientras su lote queda tomado 48 horas.
--
-- Al reintentar choca con CI_LIMIT_REACHED, cuyo mensaje le dice que consulte
-- con su código de seguimiento — que es justo lo que no tiene. Callejón sin
-- salida, con el lote congelado.
--
-- Esto devuelve esa reserva: mismo carnet, MISMO LOTE, todavía viva. Es la
-- suya, la que acaba de hacer. Sobre otro lote no devuelve nada y el límite de
-- una reserva activa por carnet sigue rigiendo igual.
create or replace function public.recuperar_reserva_del_carnet(
  p_lot_id uuid,
  p_ci text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_res public.reservations%rowtype;
  v_lot public.lots%rowtype;
  v_mz text;
  v_precio numeric(12,2);
begin
  if p_lot_id is null or btrim(coalesce(p_ci, '')) = '' then return null; end if;

  select r.* into v_res
    from public.reservations r
   where r.lot_id = p_lot_id
     and r.buyer_ci_normalized = private.normalize_ci(p_ci)
     and r.status in ('pendiente_pago', 'en_verificacion', 'rechazo_reintento')
   order by r.created_at desc
   limit 1;
  if not found then return null; end if;

  select * into v_lot from public.lots where id = v_res.lot_id;
  select m.code into v_mz from public.manzanas m where m.id = v_lot.manzana_id;
  v_precio := public.lot_price(v_lot.id);

  return jsonb_build_object(
    'tracking_code', v_res.tracking_code,
    'status', v_res.status,
    'hold_expires_at', v_res.hold_expires_at,
    'lot', jsonb_build_object('number', v_lot.number, 'manzana', v_mz,
                              'area_m2', v_lot.area_m2, 'price', v_precio),
    'reserve_amount', (select (value #>> '{}')::jsonb->>'value'
                         from public.settings where key = 'reserve_amount' limit 1),
    'payment_instructions', (select value from public.settings
                              where key = 'payment_instructions' limit 1));
end;
$$;

grant execute on function public.recuperar_reserva_del_carnet(uuid, text) to anon, authenticated, service_role;
