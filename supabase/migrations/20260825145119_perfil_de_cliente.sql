-- El cliente como eje: una persona, todos sus lotes, toda su plata.
--
-- Hasta acá todo giraba alrededor de la venta: para saber cuántos lotes tiene
-- Fulano había que buscarlo venta por venta y sumar a mano. No hay tabla de
-- clientes — el comprador vive desnormalizado en cada reserva — así que el
-- cliente se ARMA agrupando por su carnet normalizado, que es la misma llave
-- que el sistema ya usa para limitar reservas activas por persona. Para los
-- migrados sirve igual: su «MIGRADO-<id>» es estable por persona.
--
-- El nombre y el contacto se toman de su reserva MÁS RECIENTE: si la oficina
-- corrigió el teléfono en la última venta, esa es la verdad vigente.

create or replace view public.v_clientes
with (security_invoker = true) as
with base as (
  select r.buyer_ci_normalized as ci_norm,
         r.id, r.status, r.created_at, r.confirmed_at, r.client_meta,
         r.buyer_full_name, r.buyer_ci, r.buyer_phone, r.buyer_email, r.project_id
    from public.reservations r
   where coalesce(r.buyer_ci_normalized, '') <> ''
),
ultimo as (
  select distinct on (ci_norm)
         ci_norm, buyer_full_name, buyer_ci, buyer_phone, buyer_email
    from base
   order by ci_norm, created_at desc
)
select u.ci_norm,
       u.buyer_full_name,
       u.buyer_ci,
       u.buyer_phone,
       u.buyer_email,
       count(*) as reservas_totales,
       -- Compradas: ventas vivas. Una traspasada-afuera ya no es un lote suyo.
       count(*) filter (where b.status = 'confirmada') as lotes_comprados,
       count(*) filter (where b.status in ('pendiente_pago','en_verificacion','rechazo_reintento'))
         as lotes_reservados,
       count(*) filter (where b.status = 'expirada') as reservas_expiradas,
       count(*) filter (where b.status = 'cancelada') as reservas_canceladas,
       count(*) filter (where b.status = 'cancelada' and b.client_meta ? 'traspasada_a')
         as traspasos_cedidos,
       count(*) filter (where b.status = 'confirmada' and b.client_meta ? 'traspaso')
         as traspasos_recibidos,
       count(distinct b.project_id) as proyectos,
       coalesce(pg.pagado_directo, 0)
         + coalesce(mig.abonado, 0) as pagado_total,
       coalesce(vv.saldo, 0) as saldo_total,
       coalesce(vv.con_plan, 0) as con_plan,
       coalesce(pl.cuotas_vencidas, 0) as cuotas_vencidas,
       coalesce(pl.monto_vencido, 0) as monto_vencido,
       min(b.created_at) as primera_actividad,
       greatest(max(b.created_at), max(pg.ultimo_pago)) as ultima_actividad
  from ultimo u
  join base b on b.ci_norm = u.ci_norm
  left join lateral (
    -- Todo lo que esta persona nos pagó y se aprobó, venga de la reserva que
    -- venga — incluidas señas de reservas que después vencieron: esa plata
    -- entró igual.
    select sum(p.amount_bob) as pagado_directo,
           max(p.verified_at) as ultimo_pago
      from public.payments p
      join base b2 on b2.id = p.reservation_id
     where b2.ci_norm = u.ci_norm and p.status = 'aprobado'
  ) pg on true
  left join lateral (
    select sum((b2.client_meta->'reportado'->>'abonado')::numeric) as abonado
      from base b2
     where b2.ci_norm = u.ci_norm and b2.status = 'confirmada'
       and b2.client_meta ? 'reportado'
  ) mig on true
  left join lateral (
    select sum(v.saldo) as saldo, count(*) filter (where v.con_plan) as con_plan
      from public.v_ventas v
      join base b2 on b2.id = v.reservation_id
     where b2.ci_norm = u.ci_norm
  ) vv on true
  left join lateral (
    select sum(p.cuotas_vencidas) as cuotas_vencidas, sum(p.monto_vencido) as monto_vencido
      from public.v_planes p
     where private.normalize_ci(p.buyer_ci) = u.ci_norm and p.estado = 'activo'
  ) pl on true
 group by u.ci_norm, u.buyer_full_name, u.buyer_ci, u.buyer_phone, u.buyer_email,
          pg.pagado_directo, mig.abonado, vv.saldo, vv.con_plan,
          pl.cuotas_vencidas, pl.monto_vencido, pg.ultimo_pago;

grant select on public.v_clientes to authenticated;

-- El historial de pagos gana la llave del cliente y el proyecto legible, para
-- que el perfil lo lea directo (columnas al final: create or replace no deja
-- insertarlas en el medio).
create or replace view public.v_historial_pagos
with (security_invoker = true) as
select p.project_id,
       p.reservation_id,
       r.tracking_code,
       r.buyer_full_name,
       p.id as payment_id,
       p.reference_code,
       p.purpose,
       case p.purpose
         when 'reserva' then 'Seña / reserva'
         when 'cuota'   then 'Cuota'
         when 'abono'   then 'Abono'
         else p.purpose end as tipo,
       p.provider,
       private.forma_de_pago(p.provider) as forma,
       p.amount,
       p.currency,
       p.amount_bob,
       p.exchange_rate_used,
       p.status::text as estado,
       (p.verified_at at time zone 'America/La_Paz')::date as fecha,
       p.verified_at,
       p.created_at,
       p.proof_storage_path is not null as tiene_comprobante,
       p.rejection_reason::text as motivo_rechazo,
       (p.status = 'aprobado') as tiene_recibo,
       r.buyer_ci_normalized as ci_norm,
       pr.name as proyecto
  from public.payments p
  join public.reservations r on r.id = p.reservation_id
  join public.projects pr on pr.id = p.project_id;

grant select on public.v_historial_pagos to authenticated;

-- La actividad del cliente: sus reservas y ventas, de cualquier estado, con lo
-- que hace falta para contarle su historia de un vistazo.
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
       v.con_plan
  from public.reservations r
  join public.projects pr on pr.id = r.project_id
  left join public.lots l on l.id = r.lot_id
  left join public.manzanas m on m.id = l.manzana_id
  left join public.v_ventas v on v.reservation_id = r.id
 where coalesce(r.buyer_ci_normalized, '') <> '';

grant select on public.v_cliente_actividad to authenticated;
