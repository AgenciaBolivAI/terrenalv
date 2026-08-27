-- LA CARTERA — el reporte que el equipo conocía de su sistema anterior
-- (RepCarCons), con todas sus columnas. El export de ventas traía la mitad:
-- sin teléfono, sin modalidad, sin pago inicial, sin plazo ni cuota, sin
-- estado de cartera, sin promotor y sin superficie. Comparado contra la
-- planilla vieja, columna por columna.
create or replace view public.v_cartera as
select
  v.project_id,
  v.reservation_id,
  v.tracking_code                                   as codigo,
  v.proyecto,
  v.manzana,
  v.lote,
  l.area_m2                                          as sup_m2,
  v.buyer_full_name                                  as cliente,
  v.buyer_ci                                         as ci,
  v.buyer_phone                                      as telefono,
  v.fecha_venta,
  -- Modalidad: crédito si la venta tiene (o tuvo) plan de cuotas.
  case when pl.plan_id is not null then 'Crédito' else 'Contado' end as modalidad,
  v.price_agreed                                     as monto_venta,
  'Bs'                                               as moneda,
  -- El pago inicial: la cuota inicial del plan si hay; si no, lo pagado.
  coalesce(pl.down_payment, v.pagado_total)          as pago_inicial,
  pl.months                                          as plazo_meses,
  pl.monthly_amount                                  as monto_cuota,
  coalesce(pl.monthly_interest_pct, 0)               as interes_mensual_pct,
  v.pagado_total                                     as pagado,
  v.saldo,
  coalesce(pl.cuotas_pagadas, 0)                     as cuotas_pagadas,
  coalesce(pl.cuotas_vencidas, 0)                    as cuotas_vencidas,
  coalesce(pl.monto_vencido, 0)                      as monto_vencido,
  pl.proxima_cuota,
  -- El estado de cartera, con los nombres del sistema viejo:
  --   Pagado  = no debe nada.
  --   Vencido = 3 cuotas o más sin pagar: cartera en problemas.
  --   Atrasado= 1 o 2 cuotas vencidas: hay que llamarlo.
  --   Vigente = al día.
  case
    when v.saldo <= 0 then 'Pagado'
    when coalesce(pl.cuotas_vencidas, 0) >= 3 then 'Vencido'
    when coalesce(pl.cuotas_vencidas, 0) >= 1 then 'Atrasado'
    else 'Vigente'
  end                                                as estado_cartera,
  p.full_name                                        as promotor,
  v.origen_label                                     as origen,
  v.titular,
  v.titular_nombre
from public.v_ventas v
left join public.lots l on l.id = (select r.lot_id from public.reservations r where r.id = v.reservation_id)
left join public.profiles p on p.id = (select r.sold_by from public.reservations r where r.id = v.reservation_id)
left join lateral (
  select pp.plan_id, pp.down_payment, pp.months, pp.monthly_amount,
         pp.monthly_interest_pct, pp.cuotas_pagadas, pp.cuotas_vencidas,
         pp.monto_vencido, pp.proxima_cuota
    from public.v_planes pp
   where pp.reservation_id = v.reservation_id
   order by (pp.estado = 'activo') desc, pp.first_due_date desc
   limit 1
) pl on true;

alter view public.v_cartera set (security_invoker = true);

-- Verificación inmediata: cuenta y estados contra lo que ya se conoce.
select count(*) as filas,
       count(*) filter (where estado_cartera = 'Pagado')   as pagados,
       count(*) filter (where estado_cartera = 'Vigente')  as vigentes,
       count(*) filter (where estado_cartera = 'Atrasado') as atrasados,
       count(*) filter (where estado_cartera = 'Vencido')  as vencidos,
       count(*) filter (where modalidad = 'Crédito')       as credito,
       count(*) filter (where modalidad = 'Contado')       as contado,
       count(*) filter (where promotor is not null)        as con_promotor,
       count(*) filter (where sup_m2 is not null)          as con_superficie
  from public.v_cartera;
