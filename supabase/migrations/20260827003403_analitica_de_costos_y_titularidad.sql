-- Lo que las dimensiones nuevas permiten preguntar, y antes no.
--
-- Ojo: esto es analítica del GERENCIAL. No mira el libro fiscal ni puede —
-- private.fiscal_fugas() lo prohíbe y verificar_integridad() lo comprueba. La
-- cobertura de lo declarado se mira desde el módulo fiscal, que es su lado.

-- 1) ¿En qué se va la plata, más fino que «obra»?
create or replace view public.v_an_por_centro_costo as
select d.project_id,
       p.name as proyecto,
       d.centro_costo_id,
       coalesce(d.centro_costo, 'Sin centro asignado') as centro,
       cc.codigo,
       count(*) as movimientos,
       round(sum(d.debe), 2) as gastado_bob,
       min(d.fecha) as desde,
       max(d.fecha) as hasta
  from public.v_libro_diario d
  left join public.projects p on p.id = d.project_id
  left join public.centros_costo cc on cc.id = d.centro_costo_id
 -- Sólo la pata de gasto: el egreso genera dos líneas y la otra es la caja.
 where d.cuenta like '5%' and d.debe > 0
 group by d.project_id, p.name, d.centro_costo_id, d.centro_costo, cc.codigo;

alter view public.v_an_por_centro_costo set (security_invoker = true);

-- 2) ¿Cuánto del negocio corre a nombre de la empresa y cuánto de terceros?
--    Es la foto que antes no existía, y la que decide qué se declara.
create or replace view public.v_an_por_titular as
select d.project_id,
       p.name as proyecto,
       d.titular,
       coalesce(d.titular_nombre, 'La empresa') as a_nombre_de,
       count(*) filter (where d.cuenta = '4111' and d.haber > 0)          as ventas,
       round(coalesce(sum(d.haber) filter (where d.cuenta = '4111'), 0), 2) as vendido_bob,
       round(coalesce(sum(d.debe)  filter (where d.cuenta like '5%'), 0), 2) as gastado_bob,
       round(coalesce(sum(d.debe)  filter (where d.cuenta like '111%'), 0), 2) as cobrado_bob,
       count(*) as movimientos,
       min(d.fecha) as desde,
       max(d.fecha) as hasta
  from public.v_libro_diario d
  left join public.projects p on p.id = d.project_id
 group by d.project_id, p.name, d.titular, d.titular_nombre;

alter view public.v_an_por_titular set (security_invoker = true);

-- 3) Lo que entra menos lo que sale, por urbanización. Con centros de costo
--    cargados, esto deja de ser una estimación.
create or replace view public.v_an_margen_proyecto as
select p.id as project_id,
       p.name as proyecto,
       round(coalesce(sum(d.haber) filter (where d.cuenta like '4%'), 0), 2) as ingresos_bob,
       round(coalesce(sum(d.debe)  filter (where d.cuenta like '5%'), 0), 2) as egresos_bob,
       round(coalesce(sum(d.haber) filter (where d.cuenta like '4%'), 0)
           - coalesce(sum(d.debe)  filter (where d.cuenta like '5%'), 0), 2) as margen_bob,
       round(coalesce(sum(d.debe)  filter (where d.cuenta like '5%'), 0)
             / nullif(coalesce(sum(d.haber) filter (where d.cuenta like '4%'), 0), 0) * 100, 1)
         as costo_sobre_ingreso_pct
  from public.projects p
  left join public.v_libro_diario d on d.project_id = p.id
 where p.status <> 'archivado'
 group by p.id, p.name;

alter view public.v_an_margen_proyecto set (security_invoker = true);

-- 4) Los clientes que más pesan: qué compraron, qué pagaron, qué deben.
create or replace view public.v_an_por_cliente as
select v.project_id,
       max(pr.name) as proyecto,
       v.buyer_ci as cliente_ci,
       max(v.buyer_full_name) as cliente,
       count(*) as lotes,
       round(sum(v.price_agreed), 2)  as comprado_bob,
       round(sum(v.pagado_total), 2)  as pagado_bob,
       round(sum(v.saldo), 2)         as debe_bob,
       round(sum(v.pagado_total) / nullif(sum(v.price_agreed), 0) * 100, 1) as avance_pct,
       max(v.ultimo_pago) as ultimo_pago,
       bool_or(v.en_mercado) as en_mercado
  from public.v_ventas v
  left join public.projects pr on pr.id = v.project_id
 group by v.project_id, v.buyer_ci;

alter view public.v_an_por_cliente set (security_invoker = true);
