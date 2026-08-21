create or replace function public.rep_sumas_y_saldos(
  p_project_id uuid,
  p_desde date default null,
  p_hasta date default null
)
returns table (
  cuenta text, cuenta_nombre text, tipo text, sort_order int,
  debe numeric, haber numeric, saldo_deudor numeric, saldo_acreedor numeric
)
language sql
stable
security invoker
set search_path = public, extensions
as $fn$
  select
    d.cuenta,
    c.name,
    c.kind,
    c.sort_order,
    sum(d.debe)  as debe,
    sum(d.haber) as haber,
    greatest(sum(d.debe) - sum(d.haber), 0) as saldo_deudor,
    greatest(sum(d.haber) - sum(d.debe), 0) as saldo_acreedor
  from public.v_libro_diario d
  join public.chart_of_accounts c on c.code = d.cuenta
  where d.project_id = p_project_id
    and (p_desde is null or d.fecha >= p_desde)
    and (p_hasta is null or d.fecha <= p_hasta)
  group by d.cuenta, c.name, c.kind, c.sort_order
  order by c.sort_order;
$fn$;

create or replace function public.rep_estado_resultados(
  p_project_id uuid,
  p_desde date default null,
  p_hasta date default null
)
returns table (
  seccion text, cuenta text, cuenta_nombre text, sort_order int, monto numeric
)
language sql
stable
security invoker
set search_path = public, extensions
as $fn$
  select
    case when c.kind = 'ingreso' then 'Ingresos' else 'Gastos' end as seccion,
    d.cuenta,
    c.name,
    c.sort_order,
    case when c.kind = 'ingreso'
         then sum(d.haber) - sum(d.debe)
         else sum(d.debe) - sum(d.haber) end as monto
  from public.v_libro_diario d
  join public.chart_of_accounts c on c.code = d.cuenta
  where d.project_id = p_project_id
    and c.kind in ('ingreso', 'gasto')
    and (p_desde is null or d.fecha >= p_desde)
    and (p_hasta is null or d.fecha <= p_hasta)
  group by c.kind, d.cuenta, c.name, c.sort_order
  order by 1 desc, 4;
$fn$;

create or replace function public.rep_balance_general(
  p_project_id uuid,
  p_hasta date default null
)
returns table (
  seccion text, cuenta text, cuenta_nombre text, sort_order int, monto numeric
)
language sql
stable
security invoker
set search_path = public, extensions
as $fn$
  with mov as (
    select d.cuenta, c.name, c.kind, c.sort_order,
           sum(d.debe) as debe, sum(d.haber) as haber
      from public.v_libro_diario d
      join public.chart_of_accounts c on c.code = d.cuenta
     where d.project_id = p_project_id
       and (p_hasta is null or d.fecha <= p_hasta)
     group by d.cuenta, c.name, c.kind, c.sort_order
  )
  select * from (
    select
      case m.kind
        when 'activo' then 'Activo'
        when 'pasivo' then 'Pasivo'
        when 'patrimonio' then 'Patrimonio'
      end::text as seccion,
      m.cuenta::text, m.name::text, m.sort_order,
      (case when m.kind = 'activo' then m.debe - m.haber else m.haber - m.debe end)::numeric as monto
    from mov m
    where m.kind in ('activo', 'pasivo', 'patrimonio')

    union all

    select 'Patrimonio'::text, '3999'::text, 'Resultado del ejercicio'::text, 9999,
           coalesce(sum(case when c.kind = 'ingreso' then d.haber - d.debe
                             else -(d.debe - d.haber) end), 0)::numeric
      from public.v_libro_diario d
      join public.chart_of_accounts c on c.code = d.cuenta
     where d.project_id = p_project_id
       and c.kind in ('ingreso', 'gasto')
       and (p_hasta is null or d.fecha <= p_hasta)
  ) t
  order by t.seccion, t.sort_order;
$fn$;

revoke execute on function
  public.rep_sumas_y_saldos(uuid, date, date),
  public.rep_estado_resultados(uuid, date, date),
  public.rep_balance_general(uuid, date)
from public, anon;

grant execute on function
  public.rep_sumas_y_saldos(uuid, date, date),
  public.rep_estado_resultados(uuid, date, date),
  public.rep_balance_general(uuid, date)
to authenticated, service_role;
