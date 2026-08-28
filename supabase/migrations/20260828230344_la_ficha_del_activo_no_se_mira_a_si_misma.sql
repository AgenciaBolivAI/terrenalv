-- ARREGLO. Volví a caer en lo mismo que con `v_egresos`: para agregarle
-- columnas a la vista la definí como `select v.* from v_activos_fijos v join
-- fixed_assets a on a.id = v.id`. Eso la define en términos de sí misma y
-- Postgres corta con «infinite recursion detected in rules for relation».
--
-- No hay atajo: cuando hay que agregarle columnas a una vista, se vuelve a
-- escribir el cuerpo entero y se le suman al final. Y el orden de las columnas
-- que quedó registrado manda, así que las dos que faltaban van últimas.
create or replace view public.v_activos_fijos as
select a.id,
       a.project_id,
       p.name                  as proyecto,
       a.codigo,
       a.nombre,
       a.descripcion,
       a.identificacion,
       ac.codigo               as categoria_codigo,
       ac.nombre               as categoria,
       ac.cuenta_activo,
       ac.cuenta_depreciacion,
       ac.cuenta_acumulada,
       a.fecha_compra,
       a.fecha_alta,
       a.costo,
       a.valor_residual,
       a.vida_util_meses,
       a.estado,
       a.fecha_baja,
       a.motivo_baja,
       a.valor_venta,
       cc.nombre               as centro_costo,
       a.centro_costo_id,
       c.name                  as proveedor,
       a.titular,
       a.titular_nombre,
       a.expense_id,
       a.nota,
       d.mensual,
       d.meses_corridos,
       d.acumulada,
       round(a.costo - d.acumulada, 2)                       as valor_en_libros,
       greatest(0, a.vida_util_meses - d.meses_corridos)      as meses_restantes,
       (d.meses_corridos >= a.vida_util_meses)                as totalmente_depreciado,
       a.categoria_id,
       a.proveedor_contact_id,
       a.numero_factura,
       a.forma_pago,
       a.vencimiento,
       a.pagado_el,
       a.treasury_account_id,
       a.dep_acumulada_baja,
       tp.name                 as pagado_de,
       tc.name                 as comprado_de,
       ac.cuenta_activo        as cuenta_activo_codigo,
       ca.name                 as cuenta_activo_nombre,
       c.tax_id                as proveedor_nit,
       tv.name                 as venta_a
  from public.fixed_assets a
  join public.asset_categories ac on ac.id = a.categoria_id
  left join public.projects p on p.id = a.project_id
  left join public.centros_costo cc on cc.id = a.centro_costo_id
  left join public.contacts c on c.id = a.proveedor_contact_id
  left join public.chart_of_accounts ca on ca.code = ac.cuenta_activo
  left join public.treasury_accounts tp on tp.id = a.pagado_de
  left join public.treasury_accounts tc on tc.id = a.treasury_account_id
  left join public.treasury_accounts tv on tv.id = a.venta_treasury_account_id
  cross join lateral (
    select m.mensual, m.meses_corridos,
           case when m.meses_corridos >= a.vida_util_meses
                then round(a.costo - a.valor_residual, 2)
                else round(m.mensual * m.meses_corridos, 2) end as acumulada
      from (
        select round((a.costo - a.valor_residual) / a.vida_util_meses, 2) as mensual,
               least(a.vida_util_meses,
                     private.meses_completos(
                       a.fecha_alta,
                       case when a.estado = 'activo' then current_date
                            else coalesce(a.fecha_baja, current_date) end)) as meses_corridos
      ) m
  ) d;

alter view public.v_activos_fijos set (security_invoker = true);
