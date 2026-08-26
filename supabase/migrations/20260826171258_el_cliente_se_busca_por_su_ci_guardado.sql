-- Para saber qué cuotas debe cada cliente, esta vista volvía a normalizar el
-- CI de cada reserva en el momento, con una función, fila por fila. Una cuenta
-- calculada así no puede apoyarse en ningún índice: obliga a mirar todas las
-- reservas de todos los planes, por cada cliente de la lista.
--
-- Y era al pedo: reservations YA guarda el CI normalizado en su columna, y
-- coincide con la función en todas las filas (se comprobó antes de tocar).
-- Las otras cinco laterales de esta misma vista ya se enganchan por ahí; esta
-- era la única que no.

create or replace view public.v_clientes as
 with base as (
   select r.buyer_ci_normalized as ci_norm, r.id, r.status, r.created_at,
          r.confirmed_at, r.client_meta, r.buyer_full_name, r.buyer_ci,
          r.buyer_phone, r.buyer_email, r.project_id
     from public.reservations r
    where coalesce(r.buyer_ci_normalized, '') <> ''
 ), ultimo as (
   select distinct on (base.ci_norm) base.ci_norm, base.buyer_full_name,
          base.buyer_ci, base.buyer_phone, base.buyer_email
     from base order by base.ci_norm, base.created_at desc
 )
 select u.ci_norm, u.buyer_full_name, u.buyer_ci, u.buyer_phone, u.buyer_email,
    count(*) as reservas_totales,
    count(*) filter (where b.status = 'confirmada') as lotes_comprados,
    count(*) filter (where b.status = any (array['pendiente_pago'::reservation_status,'en_verificacion'::reservation_status,'rechazo_reintento'::reservation_status])) as lotes_reservados,
    count(*) filter (where b.status = 'expirada') as reservas_expiradas,
    count(*) filter (where b.status = 'cancelada') as reservas_canceladas,
    count(*) filter (where b.status = 'cancelada' and b.client_meta ? 'traspasada_a') as traspasos_cedidos,
    count(*) filter (where b.status = 'confirmada' and b.client_meta ? 'traspaso') as traspasos_recibidos,
    count(distinct b.project_id) as proyectos,
    coalesce(pg.pagado_directo, 0) + coalesce(mig.abonado, 0) as pagado_total,
    coalesce(vv.saldo, 0) as saldo_total,
    coalesce(vv.con_plan, 0::bigint) as con_plan,
    coalesce(pl.cuotas_vencidas, 0) as cuotas_vencidas,
    coalesce(pl.monto_vencido, 0) as monto_vencido,
    min(b.created_at) as primera_actividad,
    greatest(max(b.created_at), max(pg.ultimo_pago)) as ultima_actividad,
    coalesce(pg.comisiones, 0) as comisiones_pagadas,
    coalesce(mk.avisos, 0::bigint) as avisos_mercado,
    coalesce(mk.activos, 0::bigint) as avisos_activos,
    coalesce(mk.vendidos, 0::bigint) as vendidos_mercado,
    coalesce(mk.vendido_bob, 0) as vendido_mercado_bob,
    count(distinct lower(btrim(b.buyer_full_name))) as nombres_distintos,
    string_agg(distinct btrim(b.buyer_full_name), ' · ') as nombres_vistos
   from ultimo u
   join base b on b.ci_norm = u.ci_norm
   left join lateral (
     select sum(p.amount_bob) filter (where p.purpose <> 'comision') as pagado_directo,
            sum(p.amount_bob) filter (where p.purpose = 'comision')  as comisiones,
            max(p.verified_at) as ultimo_pago
       from public.payments p join base b2 on b2.id = p.reservation_id
      where b2.ci_norm = u.ci_norm and p.status = 'aprobado') pg on true
   left join lateral (
     select sum(((b2.client_meta -> 'reportado') ->> 'abonado')::numeric) as abonado
       from base b2
      where b2.ci_norm = u.ci_norm and b2.status = 'confirmada'
        and b2.client_meta ? 'reportado') mig on true
   left join lateral (
     select sum(v.saldo) as saldo, count(*) filter (where v.con_plan) as con_plan
       from public.v_ventas v join base b2 on b2.id = v.reservation_id
      where b2.ci_norm = u.ci_norm) vv on true
   -- Acá estaba el gasto: se engancha por la reserva, como todas las demás.
   left join lateral (
     select sum(p.cuotas_vencidas) as cuotas_vencidas,
            sum(p.monto_vencido)   as monto_vencido
       from public.v_planes p join base b2 on b2.id = p.reservation_id
      where b2.ci_norm = u.ci_norm and p.estado = 'activo') pl on true
   left join lateral (
     select count(*) as avisos,
            count(*) filter (where ml.status = 'activa') as activos,
            count(*) filter (where ml.fee_payment_id is not null) as vendidos,
            sum(ml.sale_price_bob) filter (where ml.fee_payment_id is not null) as vendido_bob
       from public.market_listings ml join base b2 on b2.id = ml.reservation_id
      where b2.ci_norm = u.ci_norm) mk on true
  group by u.ci_norm, u.buyer_full_name, u.buyer_ci, u.buyer_phone, u.buyer_email,
           pg.pagado_directo, pg.comisiones, mig.abonado, vv.saldo, vv.con_plan,
           pl.cuotas_vencidas, pl.monto_vencido, pg.ultimo_pago,
           mk.avisos, mk.activos, mk.vendidos, mk.vendido_bob;

alter view public.v_clientes set (security_invoker = true);

-- Buscar un cliente por su CI es de lo que más se hace en el panel, y el
-- único índice que había cubría solo las reservas sin confirmar — justo las
-- que no sirven para encontrar a un comprador.
create index if not exists reservations_ci_idx
  on public.reservations(buyer_ci_normalized)
  where buyer_ci_normalized is not null;
