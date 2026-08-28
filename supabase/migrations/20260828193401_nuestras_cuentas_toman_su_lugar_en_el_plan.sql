-- Nuestras 31 cuentas operativas toman su lugar en el árbol del plan.
--
-- El código interno no se toca: el diario automático, `verificar_integridad`
-- y los guardianes nombran a la 1131 por su código. Lo que cambia es dónde
-- cuelga y qué código se muestra.

update public.chart_of_accounts c set
     codigo_plan      = m.plan,
     parent_code      = split_part(m.plan,'.',1) || '.' || split_part(m.plan,'.',2) || '.' || split_part(m.plan,'.',3) || '.000',
     sort_order       = split_part(m.plan,'.',1)::int * 10000000
                        + split_part(m.plan,'.',2)::int * 100000
                        + split_part(m.plan,'.',3)::int * 1000
                        + split_part(m.plan,'.',4)::int,
     usa_centro_costo = left(m.plan,1) in ('4','5'),
     updated_at       = now()
  from (values
    ('1111','1.01.01.010'),('1131','1.02.01.010'),('1151','1.03.01.010'),
    ('1241','1.04.01.040'),('1242','1.04.01.080'),('1243','1.04.01.070'),
    ('1244','1.04.01.030'),('1245','1.04.01.020'),('1249','1.04.01.099'),
    ('1290','1.04.02.010'),('2131','2.01.06.010'),('3111','3.01.01.090'),
    ('3411','3.01.02.010'),('3511','3.04.01.010'),('3611','3.04.02.010'),
    ('4111','4.01.01.010'),('4211','4.02.01.090'),('4311','4.01.04.010'),
    ('4411','4.02.01.080'),('4911','4.02.01.110'),('5111','5.01.08.090'),
    ('5121','5.01.01.010'),('5211','5.01.04.190'),('5221','5.01.03.010'),
    ('5311','5.01.06.010'),('5411','5.01.04.230'),('5511','5.01.09.150'),
    ('5611','5.02.01.090'),('5711','5.02.90.010'),('5811','5.01.10.090'),
    ('5911','5.03.01.010')
  ) as m(code, plan)
 where c.code = m.code;

-- ---------------------------------------------------------------------------
-- Las dos vistas ganan `codigo` —el que se muestra— AL FINAL: meterlo en el
-- medio obligaría a un drop, y con el drop se irían los grants.
-- ---------------------------------------------------------------------------
create or replace view public.v_libro_mayor as
select d.project_id,
       d.cuenta,
       c.name as cuenta_nombre,
       c.kind as tipo,
       c.sort_order,
       sum(d.debe) as debe,
       sum(d.haber) as haber,
       case when c.kind in ('activo','gasto','orden_deudora')
            then sum(d.debe) - sum(d.haber)
            else sum(d.haber) - sum(d.debe) end as saldo,
       min(d.fecha) as desde,
       max(d.fecha) as hasta,
       coalesce(c.codigo_plan, c.code) as codigo
  from public.v_libro_diario d
  join public.chart_of_accounts c on c.code = d.cuenta
 group by d.project_id, d.cuenta, c.name, c.kind, c.sort_order, c.codigo_plan, c.code;

create or replace view public.v_plan_de_cuentas as
with recursive arbol as (
  select c.code, c.name, c.kind::text as kind, c.parent_code, c.is_active,
         c.is_system, c.moneda, c.usa_centro_costo, c.sort_order,
         0 as nivel, c.code::text as camino
    from public.chart_of_accounts c
   where c.parent_code is null
  union all
  select c.code, c.name, c.kind::text, c.parent_code, c.is_active,
         c.is_system, c.moneda, c.usa_centro_costo, c.sort_order,
         a.nivel + 1, a.camino || '>' || c.code
    from public.chart_of_accounts c
    join arbol a on a.code = c.parent_code
)
select a.*,
       not exists (select 1 from public.chart_of_accounts h
                    where h.parent_code = a.code and h.is_active) as imputable,
       (select coalesce(h.codigo_plan, h.code) from public.chart_of_accounts h
         where h.code = a.code) as codigo
  from arbol a;

alter view public.v_plan_de_cuentas set (security_invoker = true);
