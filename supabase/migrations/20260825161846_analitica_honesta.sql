-- La analítica dice la verdad completa (hallazgos confirmados de la auditoría):
--
-- 1. «Por cobrar» miraba solo cuotas de planes activos: las ventas sin
--    cronograma (migradas, abonos libres) desaparecían — Bs 276.750 hoy.
--    Ahora por_cobrar sale de v_ventas (TODO el saldo vivo) y el aging gana
--    el tramo «Sin cronograma» para esa plata.
-- 2. v_an_equipo juntaba ventas y pagos por verified_by SIN project_id: la
--    venta de una urbanización se cruzaba con los pagos de otra.
-- 3. El embudo contaba cada cadena de traspaso dos veces (la vieja y la
--    nueva confirman las dos) y la cesión salía como «cancelada»: la
--    conversión daba 22/22 con 19 ventas reales.

-- ---- 1a. Por cobrar por urbanización = saldo vivo de v_ventas.
create or replace view public.v_an_por_proyecto
with (security_invoker = true) as
select p.id as project_id,
       p.name, p.slug, p.status, p.currency,
       coalesce(lo.lotes, 0)        as lotes,
       coalesce(lo.disponibles, 0)  as disponibles,
       coalesce(lo.vendidos, 0)     as vendidos,
       coalesce(lo.reservados, 0)   as reservados,
       coalesce(lo.sin_precio, 0)   as sin_precio,
       case when coalesce(lo.lotes, 0) > 0
            then round(((coalesce(lo.vendidos, 0) + coalesce(lo.reservados, 0))::numeric
                        / lo.lotes) * 100, 1)
            else 0 end as pct_colocado,
       coalesce(ve.valor_colocado_bob, 0) as valor_colocado_bob,
       coalesce(ve.ventas, 0)             as ventas,
       ve.ultima_venta,
       coalesce(sa.por_cobrar_bob, 0) as por_cobrar_bob,
       coalesce(cc.vencido_bob, 0)    as vencido_bob,
       coalesce(cc.planes_activos, 0) as planes_activos,
       coalesce(fi.ingresos_bob, 0)  as ingresos_bob,
       coalesce(fi.egresos_bob, 0)   as egresos_bob,
       coalesce(fi.ingresos_bob, 0) - coalesce(fi.egresos_bob, 0) as resultado_bob,
       coalesce(tr.traspasos, 0) as traspasos
  from public.projects p
  left join lateral (
    select count(*) as lotes,
           count(*) filter (where l.status = 'disponible') as disponibles,
           count(*) filter (where l.status = 'vendido')    as vendidos,
           count(*) filter (where l.status = 'reservado')  as reservados,
           count(*) filter (where public.lot_price(l.id) is null) as sin_precio
      from public.lots l
     where l.project_id = p.id and l.deleted_at is null
  ) lo on true
  left join lateral (
    select count(*) as ventas,
           sum(private.to_bob(r.price_agreed, r.currency, r.project_id)) as valor_colocado_bob,
           max((r.confirmed_at at time zone 'America/La_Paz')::date) as ultima_venta
      from public.reservations r
     where r.project_id = p.id and r.confirmed_at is not null and r.status = 'confirmada'
  ) ve on true
  left join lateral (
    -- TODO el saldo vivo, con o sin cronograma: la deuda de un migrado que
    -- paga por abonos es tan por-cobrar como una cuota pactada.
    select sum(private.to_bob(v.saldo, v.currency, v.project_id)) as por_cobrar_bob
      from public.v_ventas v
     where v.project_id = p.id and v.saldo > 0
  ) sa on true
  left join lateral (
    select sum(private.to_bob(
                 case when i.due_date < current_date then i.amount - i.amount_paid else 0 end,
                 i.currency, i.project_id)) as vencido_bob,
           count(distinct i.plan_id) as planes_activos
      from public.installments i
      join public.installment_plans pl on pl.id = i.plan_id
     where i.project_id = p.id and i.status in ('pendiente', 'parcial') and pl.status = 'activo'
  ) cc on true
  left join lateral (
    select sum(c.ingresos_bob) as ingresos_bob, sum(c.egresos_bob) as egresos_bob
      from public.v_monthly_cashflow c
     where c.project_id = p.id
  ) fi on true
  left join lateral (
    select count(*) as traspasos
      from public.reservations r
     where r.project_id = p.id and r.client_meta ? 'traspaso' and r.status = 'confirmada'
  ) tr on true
 where p.status <> 'archivado';

grant select on public.v_an_por_proyecto to authenticated;

-- ---- 1b. Aging con el tramo «Sin cronograma».
create or replace view public.v_an_aging
with (security_invoker = true) as
with tramos as (
  select i.project_id,
         case when i.due_date >= current_date then 'Por vencer'
              when current_date - i.due_date between  1 and 30 then '1-30 dias'
              when current_date - i.due_date between 31 and 60 then '31-60 dias'
              when current_date - i.due_date between 61 and 90 then '61-90 dias'
              else '90+ dias' end as tramo,
         case when i.due_date >= current_date then 0
              when current_date - i.due_date between  1 and 30 then 1
              when current_date - i.due_date between 31 and 60 then 2
              when current_date - i.due_date between 61 and 90 then 3
              else 4 end as orden,
         p.reservation_id,
         i.amount - i.amount_paid as saldo,
         private.to_bob(i.amount - i.amount_paid, i.currency, i.project_id) as saldo_bob
    from public.installments i
    join public.installment_plans p on p.id = i.plan_id
   where i.status in ('pendiente', 'parcial') and p.status = 'activo'
)
select project_id, tramo, orden,
       count(*) as cuotas,
       count(distinct reservation_id) as clientes,
       sum(saldo) as monto,
       sum(saldo_bob) as monto_bob
  from tramos
 group by project_id, tramo, orden
union all
-- La deuda sin cronograma (migradas, abonos libres): sin fecha de
-- vencimiento no envejece por tramos, pero ES cartera y tiene que verse.
select v.project_id, 'Sin cronograma', 5,
       0::bigint,
       count(distinct v.reservation_id),
       sum(v.saldo),
       sum(private.to_bob(v.saldo, v.currency, v.project_id))
  from public.v_ventas v
 where v.saldo > 0 and not v.con_plan
 group by v.project_id;

grant select on public.v_an_aging to authenticated;

-- ---- 2. Equipo: ventas y pagos casados por persona Y urbanización.
create or replace view public.v_an_equipo
with (security_invoker = true) as
with s as (
  -- Cada cadena cuenta UNA vez, por su eslabón original (vivo o cedido);
  -- el eslabón nacido de un traspaso no es una venta nueva del vendedor.
  select r.verified_by, r.project_id, count(*) as ventas,
         sum(r.price_agreed) as monto,
         sum(private.to_bob(r.price_agreed, r.currency, r.project_id)) as monto_bob
    from public.reservations r
   where r.confirmed_at is not null and r.verified_by is not null
     and not (r.client_meta ? 'traspaso')
     and (r.status = 'confirmada' or r.client_meta ? 'traspasada_a')
   group by r.verified_by, r.project_id
),
v as (
  select p.verified_by, p.project_id, count(*) as verificados
    from public.payments p
   where p.status = 'aprobado' and p.verified_by is not null
   group by p.verified_by, p.project_id
),
u as (
  select coalesce(s.verified_by, v.verified_by) as verified_by,
         coalesce(s.project_id, v.project_id) as project_id,
         coalesce(s.ventas, 0) as ventas,
         coalesce(s.monto, 0) as monto,
         coalesce(s.monto_bob, 0) as monto_bob,
         coalesce(v.verificados, 0) as verificados
    from s
    full join v on v.verified_by = s.verified_by and v.project_id = s.project_id
)
select pr.id as profile_id,
       pr.full_name,
       pr.role::text as rol,
       u.project_id,
       coalesce(u.ventas, 0) as ventas_cerradas,
       coalesce(u.monto, 0) as monto_vendido,
       coalesce(u.verificados, 0) as pagos_verificados,
       coalesce(u.monto_bob, 0) as monto_vendido_bob
  from public.profiles pr
  left join u on u.verified_by = pr.id
 where pr.is_active;

grant select on public.v_an_equipo to authenticated;

-- ---- 3. El embudo cuenta cadenas, no eslabones.
create or replace view public.v_an_funnel_mensual
with (security_invoker = on) as
select
  r.project_id,
  date_trunc('month', r.created_at at time zone 'America/La_Paz')::date as mes,
  count(*)                                                      as creadas,
  count(*) filter (where exists (
    select 1 from public.payments p
     where p.reservation_id = r.id and p.proof_submitted_at is not null))  as con_comprobante,
  count(*) filter (where r.confirmed_at is not null)             as confirmadas,
  count(*) filter (where r.status = 'expirada')                  as expiradas,
  count(*) filter (where r.status = 'cancelada'
                     and not (r.client_meta ? 'traspasada_a'))   as canceladas,
  count(*) filter (where r.source = 'web')                       as web,
  count(*) filter (where r.source = 'oficina')                   as oficina,
  round(100.0 * count(*) filter (where r.confirmed_at is not null)
        / nullif(count(*), 0), 1)                                as tasa_conversion,
  round(100.0 * count(*) filter (where r.status = 'expirada')
        / nullif(count(*), 0), 1)                                as tasa_expiracion
from public.reservations r
where not (r.client_meta ? 'traspaso')
group by r.project_id, 2;

grant select on public.v_an_funnel_mensual to authenticated;
