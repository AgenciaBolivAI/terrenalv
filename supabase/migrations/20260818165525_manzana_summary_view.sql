-- Per-manzana counts for the /admin/lotes grid.
--
-- The panel used to fetch all 2.078 lots on every load purely to count them per
-- manzana in the browser. The grid needs 88 rows, not 2.078; the lots
-- themselves are only needed once a manzana is actually opened.
create or replace view public.v_manzana_summary
with (security_invoker = on) as
select
  m.id            as manzana_id,
  m.project_id,
  m.code,
  m.kind::text    as kind,
  m.sector,
  m.needs_review,
  count(l.id)                                                    as total,
  count(l.id) filter (where l.status = 'disponible')             as disponible,
  count(l.id) filter (where l.status = 'reservado')               as reservado,
  count(l.id) filter (where l.status = 'vendido')                 as vendido,
  count(l.id) filter (where l.status = 'no_disponible')           as no_disponible,
  count(l.id) filter (where l.category_id is null and l.price_override is null) as sin_precio,
  bool_or(l.needs_review)                                         as algun_lote_a_revisar
from public.manzanas m
left join public.lots l
  on l.manzana_id = m.id and l.deleted_at is null
group by m.id, m.project_id, m.code, m.kind, m.sector, m.needs_review;

grant select on public.v_manzana_summary to authenticated;
