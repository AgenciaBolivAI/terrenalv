-- La depreciación se calcula, no se carga a mano.
--
-- Línea recta: (costo − valor residual) repartido en partes iguales por los
-- meses de vida útil. Se cuenta por MESES COMPLETOS desde el alta: un bien
-- dado de alta el 15 de marzo tiene su primer mes cumplido el 15 de abril.
-- Cuando se cumple la vida útil, la acumulada se clava exactamente en
-- (costo − residual): así el bien termina en su residual y no en 0,03 de más
-- por el redondeo de la cuota mensual.

create or replace function private.meses_completos(p_desde date, p_hasta date)
returns int
language sql
immutable
parallel safe
as $$
  select greatest(0,
    (extract(year from age(p_hasta, p_desde)) * 12
     + extract(month from age(p_hasta, p_desde)))::int);
$$;

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
       (d.meses_corridos >= a.vida_util_meses)                as totalmente_depreciado
  from public.fixed_assets a
  join public.asset_categories ac on ac.id = a.categoria_id
  left join public.projects p on p.id = a.project_id
  left join public.centros_costo cc on cc.id = a.centro_costo_id
  left join public.contacts c on c.id = a.proveedor_contact_id
  cross join lateral (
    select m.mensual, m.meses_corridos,
           case when m.meses_corridos >= a.vida_util_meses
                -- Cumplida la vida útil se clava el total: el redondeo de la
                -- cuota mensual no puede dejar el bien por debajo de su
                -- residual ni un centavo.
                then round(a.costo - a.valor_residual, 2)
                else round(m.mensual * m.meses_corridos, 2) end as acumulada
      from (
        select round((a.costo - a.valor_residual) / a.vida_util_meses, 2) as mensual,
               least(a.vida_util_meses,
                     private.meses_completos(
                       a.fecha_alta,
                       -- Un bien dado de baja deja de depreciar ese día.
                       case when a.estado = 'activo' then current_date
                            else coalesce(a.fecha_baja, current_date) end)) as meses_corridos
      ) m
  ) d;

alter view public.v_activos_fijos set (security_invoker = true);

-- Cuánto deprecia cada bien en UN mes dado. Es lo que se contabiliza.
create or replace function public.depreciacion_del_mes(
  p_project_id uuid, p_anio int, p_mes int)
returns table(
  asset_id uuid, codigo text, nombre text, categoria text,
  cuenta_depreciacion text, cuenta_acumulada text,
  centro_costo_id uuid, monto numeric)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  with corte as (
    select make_date(p_anio, p_mes, 1) as inicio,
           (make_date(p_anio, p_mes, 1) + interval '1 month - 1 day')::date as fin
  )
  select a.id, a.codigo, a.nombre, ac.nombre,
         ac.cuenta_depreciacion, ac.cuenta_acumulada,
         a.centro_costo_id,
         -- Lo del mes es la diferencia entre lo acumulado al cierre del mes y
         -- lo acumulado al cierre del mes anterior. Así el mes en que el bien
         -- termina su vida útil sale con el resto exacto, no con la cuota.
         round(
           (case when private.meses_completos(a.fecha_alta, c.fin) >= a.vida_util_meses
                 then a.costo - a.valor_residual
                 else round((a.costo - a.valor_residual) / a.vida_util_meses, 2)
                      * least(a.vida_util_meses, private.meses_completos(a.fecha_alta, c.fin))
            end)
         - (case when private.meses_completos(a.fecha_alta, c.inicio - 1) >= a.vida_util_meses
                 then a.costo - a.valor_residual
                 else round((a.costo - a.valor_residual) / a.vida_util_meses, 2)
                      * least(a.vida_util_meses, private.meses_completos(a.fecha_alta, c.inicio - 1))
            end), 2) as monto
    from public.fixed_assets a
    join public.asset_categories ac on ac.id = a.categoria_id
    cross join corte c
   where (p_project_id is null or a.project_id = p_project_id)
     and a.fecha_alta <= c.fin
     -- Un bien dado de baja no deprecia después de la baja.
     and (a.estado = 'activo' or coalesce(a.fecha_baja, c.fin) >= c.inicio);
$$;

grant execute on function public.depreciacion_del_mes(uuid, int, int) to authenticated;
revoke execute on function public.depreciacion_del_mes(uuid, int, int) from anon;
