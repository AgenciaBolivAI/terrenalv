-- v_ventas reconoce el traspaso.
--
-- Sin esto, una venta recién traspasada caía en «Sin cuota inicial»: no tiene
-- cobros propios todavía y no es migrada. Pero la compra viene andando desde
-- el comprador anterior — el arrastre (`reportado.abonado`) lo demuestra — así
-- que compra_iniciada ahora también mira eso. Y las columnas nuevas dejan ver
-- de quién vino el lote sin abrir la auditoría.
create or replace view public.v_ventas
with (security_invoker = true) as
select r.project_id,
       r.id as reservation_id,
       r.tracking_code,
       r.buyer_full_name,
       r.buyer_ci,
       r.buyer_phone,
       r.buyer_email,
       (r.confirmed_at at time zone 'America/La_Paz')::date as fecha_venta,
       r.price_agreed,
       r.currency,
       m.code as manzana,
       l.number as lote,
       p.name as proyecto,
       (r.client_meta ? 'migrado_de') as migrada,
       coalesce((r.client_meta->'reportado'->>'deuda')::numeric, null) as deuda_migrada,
       coalesce(pg.total, 0) as cobrado_aqui,
       coalesce(pg.cuotas, 0) as pagos_cuota,
       coalesce(pg.abonos, 0) as pagos_abono,
       greatest(0, coalesce((r.client_meta->'reportado'->>'deuda')::numeric, r.price_agreed)
                   - coalesce(pg.total, 0)) as saldo,
       exists (select 1 from public.installment_plans ip
                where ip.reservation_id = r.id and ip.status = 'activo') as con_plan,
       pg.ultimo_pago,
       ((r.client_meta ? 'migrado_de')
        or (r.client_meta ? 'traspaso')
        or coalesce((r.client_meta->'reportado'->>'abonado')::numeric, 0) > 0
        or coalesce(pg.total, 0) > 0) as compra_iniciada,
       coalesce((r.client_meta->'reportado'->>'abonado')::numeric, 0) as abonado_migrado,
       coalesce((r.client_meta->'reportado'->>'abonado')::numeric, 0) + coalesce(pg.total, 0)
         as pagado_total,
       r.source,
       private.origen_de_venta(r.source, r.client_meta, r.created_at, r.confirmed_at) as origen,
       private.etiqueta_origen(
         private.origen_de_venta(r.source, r.client_meta, r.created_at, r.confirmed_at)
       ) as origen_label,
       (r.client_meta ? 'origen') as origen_declarado,
       coalesce(sn.total, 0) as sena_pagada,
       sn.fecha as sena_fecha,
       coalesce(sn.forma, '') as sena_forma,
       (r.client_meta ? 'traspaso') as traspaso,
       r.client_meta->'traspaso'->>'de_tracking' as traspaso_de_tracking,
       r.client_meta->'traspaso'->>'de_comprador' as traspaso_de_comprador,
       (r.client_meta->'traspaso'->>'pagado_arrastrado')::numeric as traspaso_pagado,
       r.client_meta->'traspasada_a'->>'tracking' as traspasada_a_tracking
  from public.reservations r
  join public.projects p on p.id = r.project_id
  left join public.lots l on l.id = r.lot_id
  left join public.manzanas m on m.id = l.manzana_id
  left join lateral (
    select sum(x.amount_bob) as total,
           count(*) filter (where x.purpose = 'cuota') as cuotas,
           count(*) filter (where x.purpose = 'abono') as abonos,
           max((x.verified_at at time zone 'America/La_Paz')::date) as ultimo_pago
      from public.payments x
     where x.reservation_id = r.id and x.status = 'aprobado' and x.purpose <> 'reserva'
  ) pg on true
  left join lateral (
    select sum(x.amount_bob) as total,
           max((x.verified_at at time zone 'America/La_Paz')::date) as fecha,
           max(private.forma_de_pago(x.provider)) as forma
      from public.payments x
     where x.reservation_id = r.id and x.status = 'aprobado' and x.purpose = 'reserva'
  ) sn on true
 where r.status = 'confirmada';

grant select on public.v_ventas to authenticated;
