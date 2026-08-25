-- La vidriera calcula el saldo directo de las tablas, sin pasar por v_ventas:
-- esa vista es security_invoker y evalúa como el que consulta — anon — así que
-- la RLS de reservas la dejaba vacía y el mercado no mostraba nada.
create or replace view public.v_mercado as
select ml.id as listing_id,
       pr.name as proyecto,
       pr.slug,
       m.code as manzana,
       l.number as lote,
       l.area_m2,
       r.price_agreed as precio_lote,
       greatest(0, coalesce((r.client_meta->'reportado'->>'deuda')::numeric, r.price_agreed)
                   - coalesce(pg.total, 0)) as saldo_a_asumir,
       ml.asking_price_bob,
       ml.note,
       (ml.created_at at time zone 'America/La_Paz')::date as publicada
  from public.market_listings ml
  join public.reservations r on r.id = ml.reservation_id
  join public.projects pr on pr.id = r.project_id
  left join public.lots l on l.id = r.lot_id
  left join public.manzanas m on m.id = l.manzana_id
  left join lateral (
    select sum(x.amount_bob) as total
      from public.payments x
     where x.reservation_id = r.id and x.status = 'aprobado' and x.purpose <> 'reserva'
  ) pg on true
 where ml.status = 'activa' and r.status = 'confirmada';

grant select on public.v_mercado to anon, authenticated;
