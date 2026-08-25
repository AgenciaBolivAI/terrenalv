-- La vidriera dice QUÉ es cada aviso — son dos negocios distintos:
--   * TRASPASO: la compra está en curso; el interesado le paga al vendedor lo
--     suyo Y asume el saldo con Terrenalv (costo total = pide + saldo).
--   * VENTA DE DUEÑO: el lote está pagado por completo; se compra al dueño y
--     no se asume ninguna deuda.
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
       (ml.created_at at time zone 'America/La_Paz')::date as publicada,
       ml.fee_pct,
       case when greatest(0, coalesce((r.client_meta->'reportado'->>'deuda')::numeric, r.price_agreed)
                             - coalesce(pg.total, 0)) > 0
            then 'traspaso' else 'venta' end as tipo
  from public.market_listings ml
  join public.reservations r on r.id = ml.reservation_id
  join public.projects pr on pr.id = r.project_id
  left join public.lots l on l.id = r.lot_id
  left join public.manzanas m on m.id = l.manzana_id
  left join lateral (
    select sum(x.amount_bob) as total
      from public.payments x
     where x.reservation_id = r.id and x.status = 'aprobado'
       and x.purpose in ('cuota','abono')
  ) pg on true
 where ml.status = 'activa' and r.status = 'confirmada';

grant select on public.v_mercado to anon, authenticated;
