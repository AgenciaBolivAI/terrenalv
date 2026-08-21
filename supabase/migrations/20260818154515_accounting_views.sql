create or replace view public.v_account_status
with (security_invoker = on) as
select
  p.id                as plan_id,
  p.project_id,
  p.reservation_id,
  p.status            as plan_status,
  p.total_price,
  p.down_payment,
  p.financed_amount,
  p.months,
  p.monthly_amount,
  p.currency,
  p.first_due_date,
  r.tracking_code,
  r.buyer_full_name,
  r.buyer_phone,
  r.buyer_ci,
  m.code              as manzana,
  l.number            as lote,
  coalesce(sum(i.amount)      filter (where i.status <> 'anulada'), 0) as total_cuotas,
  coalesce(sum(i.amount_paid) filter (where i.status <> 'anulada'), 0) as pagado,
  coalesce(sum(i.amount - i.amount_paid) filter (where i.status <> 'anulada'), 0) as saldo,
  count(*) filter (
    where i.status in ('pendiente', 'parcial') and i.due_date < current_date
  ) as cuotas_vencidas,
  coalesce(sum(i.amount - i.amount_paid) filter (
    where i.status in ('pendiente', 'parcial') and i.due_date < current_date
  ), 0) as monto_vencido,
  count(*) filter (where i.status = 'pagada') as cuotas_pagadas,
  count(*) filter (where i.status <> 'anulada') as cuotas_totales,
  min(i.due_date) filter (where i.status in ('pendiente', 'parcial')) as proxima_cuota,
  (current_date - min(i.due_date) filter (
    where i.status in ('pendiente', 'parcial') and i.due_date < current_date
  ))::int as dias_atraso
from public.installment_plans p
join public.reservations r on r.id = p.reservation_id
join public.lots l         on l.id = r.lot_id
join public.manzanas m     on m.id = l.manzana_id
left join public.installments i on i.plan_id = p.id
group by p.id, r.id, m.code, l.number;

create or replace view public.v_monthly_cashflow
with (security_invoker = on) as
select
  project_id,
  mes,
  sum(ingresos)  as ingresos_bob,
  sum(egresos)   as egresos_bob,
  sum(ingresos) - sum(egresos) as resultado_bob
from (
  select
    project_id,
    date_trunc('month', verified_at at time zone 'America/La_Paz')::date as mes,
    sum(amount_bob) as ingresos,
    0::numeric      as egresos
  from public.payments
  where status = 'aprobado' and verified_at is not null
  group by project_id, 2

  union all

  select
    project_id,
    date_trunc('month', incurred_on)::date as mes,
    0::numeric      as ingresos,
    sum(amount_bob) as egresos
  from public.expenses
  where deleted_at is null
  group by project_id, 2
) t
group by project_id, mes;

grant select on public.v_account_status, public.v_monthly_cashflow to authenticated;
