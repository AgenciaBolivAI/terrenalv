-- comprada_en_mercado decía null (no false) cuando la venta no venía de
-- traspaso: el operador ? sobre una llave ausente devuelve null. Booleano de
-- verdad, para que ningún consumidor tropiece.
create or replace view public.v_cliente_actividad
with (security_invoker = true) as
select r.buyer_ci_normalized as ci_norm,
       r.id as reservation_id,
       r.tracking_code,
       r.status::text as estado,
       pr.name as proyecto,
       m.code as manzana,
       l.number as lote,
       r.price_agreed,
       r.created_at,
       (r.confirmed_at at time zone 'America/La_Paz')::date as fecha_confirmada,
       (r.cancelled_at at time zone 'America/La_Paz')::date as fecha_cancelada,
       r.cancel_reason,
       (r.client_meta ? 'traspaso') as recibida_por_traspaso,
       (r.client_meta ? 'traspasada_a') as cedida_por_traspaso,
       r.client_meta->'traspasada_a'->>'tracking' as cedida_a_tracking,
       private.etiqueta_origen(
         private.origen_de_venta(r.source, r.client_meta, r.created_at, r.confirmed_at)
       ) as origen_label,
       v.pagado_total,
       v.saldo,
       v.con_plan,
       coalesce((r.client_meta->'traspaso' ? 'mercado'), false) as comprada_en_mercado,
       (r.client_meta->'traspaso'->'mercado'->>'precio')::numeric as precio_mercado,
       exists (select 1 from public.market_listings ml
                where ml.reservation_id = r.id and ml.fee_payment_id is not null)
         as vendida_en_mercado
  from public.reservations r
  join public.projects pr on pr.id = r.project_id
  left join public.lots l on l.id = r.lot_id
  left join public.manzanas m on m.id = l.manzana_id
  left join public.v_ventas v on v.reservation_id = r.id
 where coalesce(r.buyer_ci_normalized, '') <> '';

grant select on public.v_cliente_actividad to authenticated;
