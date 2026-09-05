-- get_lot_statuses es el RPC MÁS caliente del sitio: lo llama todo el que abre
-- el mapa, y otra vez cada vez que el mapa se refresca.
--
-- Llamaba a public.lot_price(l.id) DOS veces por lote —una para saber si tiene
-- precio y otra para traerlo— y cada llamada vuelve a buscar el lote por id y a
-- unir pricing_categories. Con 2.078 lotes publicados son 4.156 búsquedas de
-- más:
--
--   antes:  154 ms · 17.683 buffers
--
-- La misma cuenta hecha una sola vez, con el join en el conjunto, da el MISMO
-- jsonb (comprobado: 2.078 lotes, igualdad exacta del objeto completo).

create or replace function public.get_lot_statuses(p_project_id uuid)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  with precios as (
    select l.id, l.status,
           -- El precio del lote, calculado UNA vez: el override manda y si no
           -- hay, sale de la categoría por metro cuadrado.
           coalesce(l.price_override, round(pc.price_per_m2 * l.area_m2, 0)) as precio
      from public.lots l
      left join public.pricing_categories pc on pc.id = l.category_id
     where l.project_id = p_project_id
       and l.state = 'published'
       and l.deleted_at is null
  )
  select jsonb_build_object(
    'status_rev', (select status_rev from public.projects where id = p_project_id),
    'server_now', now(),
    'lots', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'st', p.status,
               'priced', (p.precio is not null),
               'price', p.precio))
        from precios p), '[]'::jsonb));
$function$;
