-- La migración anterior agregó la seña a v_planes con un «select * from
-- v_planes» adentro — la vista quedó apuntándose a sí misma y Postgres se
-- niega a consultarla (recursión infinita). Duró minutos, pero /admin/planes
-- y los estados de cuenta quedaron caídos en ese rato.
--
-- Acá está la definición completa, sana, con la seña al final. Es la que
-- manda: si se reconstruye la base desde las migraciones, esta pisa a la rota.

create or replace view public.v_planes
with (security_invoker = true) as
select pl.id as plan_id,
       pl.project_id,
       pl.reservation_id,
       pr.name as proyecto,
       r.tracking_code,
       r.buyer_full_name,
       r.buyer_phone,
       r.buyer_ci,
       m.code as manzana,
       l.number as lote,
       pl.status::text as estado,
       pl.total_price,
       pl.down_payment,
       pl.financed_amount,
       pl.months,
       pl.monthly_amount,
       pl.annual_interest_pct,
       pl.first_due_date,
       pl.currency,
       coalesce(c.cuotas, 0) as cuotas_totales,
       coalesce(c.pagadas, 0) as cuotas_pagadas,
       coalesce(c.vencidas, 0) as cuotas_vencidas,
       coalesce(c.pagado, 0) as pagado,
       coalesce(c.pendiente, 0) as saldo,
       coalesce(c.vencido, 0) as monto_vencido,
       c.proxima_cuota,
       c.dias_atraso,
       case when coalesce(c.cuotas, 0) > 0
            then round(coalesce(c.pagadas, 0)::numeric * 100 / c.cuotas, 1)
            else 0 end as avance_pct,
       pl.monthly_interest_pct,
       coalesce(c.total_cuotas, 0) as total_a_pagar,
       coalesce(c.total_interes, 0) as intereses_totales,
       -- La seña que puso al reservar: el recibo la muestra, así que las
       -- condiciones del plan también, o las dos pantallas se contradicen.
       coalesce(s.total, 0) as sena_pagada
  from public.installment_plans pl
  join public.projects pr on pr.id = pl.project_id
  join public.reservations r on r.id = pl.reservation_id
  left join public.lots l on l.id = r.lot_id
  left join public.manzanas m on m.id = l.manzana_id
  left join lateral (
    select count(*) filter (where i.status <> 'anulada') as cuotas,
           count(*) filter (where i.status = 'pagada') as pagadas,
           count(*) filter (where i.status in ('pendiente','parcial')
                              and i.due_date < current_date) as vencidas,
           sum(i.amount_paid) as pagado,
           sum(case when i.status in ('pendiente','parcial')
                    then i.amount - i.amount_paid else 0 end) as pendiente,
           sum(case when i.status in ('pendiente','parcial') and i.due_date < current_date
                    then i.amount - i.amount_paid else 0 end) as vencido,
           min(case when i.status in ('pendiente','parcial') then i.due_date end) as proxima_cuota,
           max(case when i.status in ('pendiente','parcial') and i.due_date < current_date
                    then current_date - i.due_date end) as dias_atraso,
           sum(case when i.status <> 'anulada' then i.amount else 0 end) as total_cuotas,
           sum(case when i.status <> 'anulada' then i.interes else 0 end) as total_interes
      from public.installments i
     where i.plan_id = pl.id
  ) c on true
  left join lateral (
    select sum(p.amount_bob) as total
      from public.payments p
     where p.reservation_id = pl.reservation_id
       and p.purpose = 'reserva' and p.status = 'aprobado'
  ) s on true;

alter view public.v_planes set (security_invoker = true);
grant select on public.v_planes to authenticated;
