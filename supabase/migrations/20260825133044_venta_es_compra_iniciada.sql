-- Qué es una VENTA, dicho por el negocio: una reserva confirmada donde la
-- compra realmente arrancó — entró la cuota inicial o un abono, o vino del
-- sistema anterior ya vendida. Una reserva confirmada cuyo comprador nunca
-- puso la cuota inicial NO es una venta todavía: es una reserva que hay que
-- perseguir.
--
-- La regla vive en la vista y no en cada pantalla, para que Ventas, Reservas y
-- los reportes cuenten lo mismo. Columna al final: create or replace no deja
-- insertarla en el medio.
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
       ((r.client_meta ? 'migrado_de') or coalesce(pg.total, 0) > 0) as compra_iniciada
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
 where r.status = 'confirmada';

grant select on public.v_ventas to authenticated;
