-- Una fila por urbanización, con las cifras que se comparan entre proyectos.
--
-- Arranca de `projects` con LEFT JOIN a propósito: una urbanización recién
-- creada, sin un solo lote vendido, tiene que aparecer igual con ceros. Si
-- saliera de las ventas, un proyecto nuevo simplemente no existiría en el
-- tablero y nadie notaría que no se está vendiendo nada ahí.
--
-- Todo en BOB para que las filas se puedan sumar aunque un proyecto se lleve
-- en dólares.
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

       coalesce(cc.por_cobrar_bob, 0) as por_cobrar_bob,
       coalesce(cc.vencido_bob, 0)    as vencido_bob,
       coalesce(cc.planes_activos, 0) as planes_activos,

       coalesce(fi.ingresos_bob, 0)  as ingresos_bob,
       coalesce(fi.egresos_bob, 0)   as egresos_bob,
       coalesce(fi.ingresos_bob, 0) - coalesce(fi.egresos_bob, 0) as resultado_bob

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
     where r.project_id = p.id and r.confirmed_at is not null
  ) ve on true

  left join lateral (
    select sum(private.to_bob(i.amount - i.amount_paid, i.currency, i.project_id)) as por_cobrar_bob,
           sum(private.to_bob(
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

 where p.status <> 'archivado';

grant select on public.v_an_por_proyecto to authenticated;
