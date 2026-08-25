-- El registro de traspasos: cada cesión con su historia completa.
--
-- La información ya existía repartida entre client_meta, la auditoría y el
-- mercado; nadie podía verla junta. Acá queda: cuándo, qué lote, quién cedió,
-- quién recibió, cuánta plata se arrastró, cuánto saldo asumió el nuevo, qué
-- empleado lo firmó, y si nació de un acuerdo en el mercado (con su precio y
-- su comisión) o fue un traspaso directo de mostrador.
create or replace view public.v_traspasos
with (security_invoker = true) as
select nueva.id as reservation_id,
       nueva.tracking_code,
       (nueva.confirmed_at at time zone 'America/La_Paz')::date as fecha,
       nueva.confirmed_at,
       pr.name as proyecto,
       nueva.project_id,
       m.code as manzana,
       l.number as lote,
       l.area_m2,
       -- Quién cedió
       nueva.client_meta->'traspaso'->>'de_comprador' as cedente,
       nueva.client_meta->'traspaso'->>'de_ci' as cedente_ci,
       nueva.client_meta->'traspaso'->>'de_tracking' as cedente_tracking,
       (nueva.client_meta->'traspaso'->>'de_reservation')::uuid as cedente_reservation,
       -- Quién recibió
       nueva.buyer_full_name as comprador,
       nueva.buyer_ci as comprador_ci,
       nueva.buyer_phone as comprador_telefono,
       -- La plata
       (nueva.client_meta->'traspaso'->>'pagado_arrastrado')::numeric as pagado_arrastrado,
       (nueva.client_meta->'traspaso'->>'saldo_arrastrado')::numeric as saldo_arrastrado,
       nueva.price_agreed as precio_lote,
       v.saldo as saldo_hoy,
       v.pagado_total as pagado_hoy,
       -- Por dónde vino: mercado (con precio y comisión) o mostrador
       (nueva.client_meta->'traspaso' ? 'mercado') as por_mercado,
       (nueva.client_meta->'traspaso'->'mercado'->>'precio')::numeric as precio_pactado,
       (nueva.client_meta->'traspaso'->'mercado'->>'comision_pct')::numeric as comision_pct,
       (nueva.client_meta->'traspaso'->'mercado'->>'comision_bob')::numeric as comision_bob,
       ml.fee_payment_id as comision_recibo,
       -- Quién lo firmó
       nueva.verified_by,
       prof.full_name as empleado,
       prof.role::text as empleado_rol,
       nueva.client_meta->'traspaso'->>'motivo' as motivo,
       nueva.status::text as estado_actual,
       exists (select 1 from public.installment_plans ip
                where ip.reservation_id = nueva.id and ip.status = 'activo') as con_plan
  from public.reservations nueva
  join public.projects pr on pr.id = nueva.project_id
  left join public.lots l on l.id = nueva.lot_id
  left join public.manzanas m on m.id = l.manzana_id
  left join public.v_ventas v on v.reservation_id = nueva.id
  left join public.profiles prof on prof.id = nueva.verified_by
  left join public.market_listings ml
    on ml.id = (nueva.client_meta->'traspaso'->'mercado'->>'listing_id')::uuid
 where nueva.client_meta ? 'traspaso';

grant select on public.v_traspasos to authenticated;
