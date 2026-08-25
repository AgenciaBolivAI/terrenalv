-- El registro de referidos: TODO lo que pasó, en orden, con nombre y apellido.
--
-- La pantalla de comisiones dice cuánto le toca a cada uno HOY. Esto dice qué
-- fue pasando: quién tomó qué reserva, qué venta cerró, cuánta comisión
-- generó y cuándo se le pagó. Es lo que se mira cuando alguien reclama, o
-- cuando hay que auditar por qué a una persona le pagaron lo que le pagaron.
create or replace view public.v_referidos_movimientos
with (security_invoker = true) as
-- 1. Reservas tomadas (todavía no son venta)
select r.id as movimiento_id,
       'reserva'::text as tipo,
       coalesce(r.confirmed_at, r.created_at) as cuando,
       r.project_id,
       pr.name as proyecto,
       r.sold_by as profile_id,
       p.full_name as empleado,
       p.role::text as rol,
       r.id as reservation_id,
       r.tracking_code,
       m.code as manzana,
       l.number as lote,
       r.buyer_full_name as comprador,
       r.price_agreed as monto,
       0::numeric as comision,
       r.status::text as estado,
       null::text as nota
  from public.reservations r
  join public.projects pr on pr.id = r.project_id
  join public.profiles p on p.id = r.sold_by
  left join public.lots l on l.id = r.lot_id
  left join public.manzanas m on m.id = l.manzana_id
 where r.sold_by is not null
   and r.status in ('pendiente_pago','en_verificacion','rechazo_reintento','expirada')
union all
-- 2. Ventas cerradas, con la comisión que generaron
select r.id, 'venta', r.confirmed_at, r.project_id, pr.name,
       r.sold_by, p.full_name, p.role::text,
       r.id, r.tracking_code, m.code, l.number, r.buyer_full_name,
       r.price_agreed,
       round(case when coalesce(r.commission_base,'cobrado') = 'precio'
                  then r.price_agreed else private.capital_pagado(r.id) end
             * coalesce(r.commission_pct, 0) / 100, 2),
       r.status::text,
       coalesce(r.commission_pct, 0) || '% sobre ' || coalesce(r.commission_base, 'cobrado')
  from public.reservations r
  join public.projects pr on pr.id = r.project_id
  join public.profiles p on p.id = r.sold_by
  left join public.lots l on l.id = r.lot_id
  left join public.manzanas m on m.id = l.manzana_id
 where r.sold_by is not null
   and (r.status = 'confirmada' or r.client_meta ? 'traspasada_a')
union all
-- 3. Comisiones pagadas
select e.id, 'pago_comision', e.incurred_on::timestamptz, e.project_id, pr.name,
       e.profile_id, p.full_name, p.role::text,
       e.reservation_id, r.tracking_code, m.code, l.number, r.buyer_full_name,
       e.amount_bob, e.amount_bob, 'pagado', e.note
  from public.expenses e
  join public.profiles p on p.id = e.profile_id
  join public.projects pr on pr.id = e.project_id
  left join public.reservations r on r.id = e.reservation_id
  left join public.lots l on l.id = r.lot_id
  left join public.manzanas m on m.id = l.manzana_id
 where e.category = 'comisiones' and e.deleted_at is null and e.profile_id is not null;

grant select on public.v_referidos_movimientos to authenticated;
