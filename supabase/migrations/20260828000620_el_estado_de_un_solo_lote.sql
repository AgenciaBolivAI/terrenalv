-- La página donde el comprador decide reservar bajaba los 5.927 lotes de la
-- urbanización para leer UNO — 203 kB de JSON y ~1,5 s, con el comprador
-- mirando la pantalla. get_lot_statuses no se toca (el mapa sí los necesita
-- todos): esto es su hermano de una sola fila.
create or replace function public.get_lot_status(p_lot_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
  select jsonb_build_object(
    'id', l.id,
    'st', case
            when l.status = 'disponible'
             and exists (select 1 from public.reservations r
                          where r.lot_id = l.id
                            and r.status in ('pendiente_pago','en_verificacion','rechazo_reintento')
                            and coalesce(r.hold_expires_at, r.retry_expires_at) > now())
            then 'reservado'::text
            else l.status::text
          end,
    'priced', public.lot_price(l.id) is not null,
    'price', public.lot_price(l.id),
    'server_now', now())
  from public.lots l
  where l.id = p_lot_id and l.state = 'published';
$$;

grant execute on function public.get_lot_status(uuid) to anon, authenticated, service_role;
