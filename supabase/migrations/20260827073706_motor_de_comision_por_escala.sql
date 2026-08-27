-- El motor: cuántas ventas lleva cada asesor, en qué tramo cae eso, y cuánto
-- de la comisión ya se ganó.
--
-- Todo set-based, en un solo recorrido por cada tabla. Nada de una función
-- por fila: ese error ya se pagó caro en v_ventas.

create or replace view public.v_comisiones_escala as
with ventas as (
  select r.id as reservation_id, r.project_id, r.sold_by, r.tracking_code,
         r.price_agreed as precio, r.confirmed_at,
         extract(year from (r.confirmed_at at time zone 'America/La_Paz'))::int as gestion,
         to_char(r.confirmed_at at time zone 'America/La_Paz', 'YYYY-MM') as mes,
         -- Al contado o a plazo: lo dice si se le armó un plan de cuotas.
         case when exists (select 1 from public.installment_plans ip
                            where ip.reservation_id = r.id and ip.status <> 'cancelado')
              then 'plazo' else 'contado' end as modalidad
    from public.reservations r
   where r.sold_by is not null
     and r.confirmed_at is not null
     and (r.status = 'confirmada' or r.client_meta ? 'traspasada_a')
), conperiodo as (
  select v.*,
         coalesce(p.periodo, 'gestion') as periodo,
         case when coalesce(p.periodo, 'gestion') = 'mes' then v.mes else v.gestion::text end
           as clave_periodo,
         coalesce(p.cuota_reintegro, 4) as cuota_reintegro
    from ventas v
    left join public.commission_policy p on p.gestion = v.gestion
), conteo as (
  -- Cuántas ventas lleva ese asesor, en ese período y en esa modalidad.
  select sold_by, clave_periodo, modalidad, gestion, count(*) as ventas_periodo
    from conperiodo
   group by sold_by, clave_periodo, modalidad, gestion
), tarifa as (
  -- El tramo donde cae ese conteo. Retroactivo: el % del tramo alcanzado se
  -- aplica a TODAS las ventas del período, no sólo a la que lo desbloqueó.
  select c.*, e.pct_inicial, e.pct_reintegro
    from conteo c
    left join public.commission_scales e
      on e.is_active and e.gestion = c.gestion and e.modalidad = c.modalidad
     and c.ventas_periodo >= e.desde
     and (e.hasta is null or c.ventas_periodo <= e.hasta)
), avance as (
  -- Cuánto pagó el comprador, para saber qué tramo de comisión se devengó.
  select cp.reservation_id,
         pl.down_payment,
         coalesce(cap.capital, 0) as capital_pagado,
         coalesce(cuo.pagadas, 0) as cuotas_pagadas
    from conperiodo cp
    left join public.installment_plans pl
           on pl.reservation_id = cp.reservation_id and pl.status <> 'cancelado'
    left join lateral (
      select sum(case
                   when x.purpose = 'reserva' then x.amount_bob
                   when x.purpose in ('cuota','abono') then x.amount_bob - coalesce(x.interest_bob, 0)
                   else 0 end) as capital
        from public.payments x
       where x.reservation_id = cp.reservation_id and x.status = 'aprobado') cap on true
    left join lateral (
      select count(*) as pagadas from public.installments i
       where i.plan_id = pl.id and i.status = 'pagada') cuo on true
)
select
  cp.reservation_id,
  cp.project_id,
  cp.sold_by as profile_id,
  cp.tracking_code,
  cp.precio,
  cp.modalidad,
  cp.gestion,
  cp.periodo,
  cp.clave_periodo,
  t.ventas_periodo,
  coalesce(t.pct_inicial, 0)   as pct_inicial,
  coalesce(t.pct_reintegro, 0) as pct_reintegro,
  coalesce(t.pct_inicial, 0) + coalesce(t.pct_reintegro, 0) as pct_total,
  round(cp.precio * (coalesce(t.pct_inicial, 0) + coalesce(t.pct_reintegro, 0)) / 100, 2)
    as comision_total,
  round(cp.precio * coalesce(t.pct_inicial, 0) / 100, 2)   as tramo_inicial,
  round(cp.precio * coalesce(t.pct_reintegro, 0) / 100, 2) as tramo_reintegro,
  -- Al contado se gana toda al momento de la venta. A plazo, por mitades:
  -- una al completar la cuota inicial y la otra al completar la 4ta cuota
  -- (política 1; el número de cuota lo fija commission_policy).
  case when cp.modalidad = 'contado' then true
       else a.capital_pagado > 0 and a.capital_pagado >= coalesce(a.down_payment, 0) end
    as inicial_cumplida,
  case when cp.modalidad = 'contado' then true
       else a.cuotas_pagadas >= cp.cuota_reintegro end
    as reintegro_cumplido,
  a.cuotas_pagadas,
  cp.cuota_reintegro,
  case
    when cp.modalidad = 'contado'
      then round(cp.precio * (coalesce(t.pct_inicial, 0) + coalesce(t.pct_reintegro, 0)) / 100, 2)
    else
      (case when a.capital_pagado > 0 and a.capital_pagado >= coalesce(a.down_payment, 0)
            then round(cp.precio * coalesce(t.pct_inicial, 0) / 100, 2) else 0 end)
    + (case when a.cuotas_pagadas >= cp.cuota_reintegro
            then round(cp.precio * coalesce(t.pct_reintegro, 0) / 100, 2) else 0 end)
  end as devengado
from conperiodo cp
left join tarifa t
       on t.sold_by = cp.sold_by and t.clave_periodo = cp.clave_periodo
      and t.modalidad = cp.modalidad
left join avance a on a.reservation_id = cp.reservation_id;

alter view public.v_comisiones_escala set (security_invoker = true);
