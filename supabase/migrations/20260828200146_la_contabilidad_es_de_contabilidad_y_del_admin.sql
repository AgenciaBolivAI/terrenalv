-- LA CONTABILIDAD ES DE CONTABILIDAD Y DEL ADMIN.
--
-- El panel ya lo respetaba: `private.nivel_de(uid,'contabilidad')` devuelve
-- 'no' para un vendedor, así que la sección no le aparece. Pero la RLS de las
-- tablas de origen (reservations, payments, expenses, journal_entries) es de
-- EQUIPO, no de contabilidad — como debe ser, un vendedor necesita sus
-- reservas y sus cobros. Con las vistas del libro corriendo como quien mira,
-- eso dejaba a un vendedor leyendo el libro entero con solo pedir la vista
-- desde fuera del panel. Comprobado: Beymar (ventas) veía los 143
-- movimientos.
--
-- Esconder una pantalla no es un permiso. El permiso va acá, en la vista, con
-- la MISMA regla que ya gobierna el panel — para que no haya dos verdades
-- sobre quién puede ver la contabilidad.
create or replace function private.ve_contabilidad()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'private'
as $$
  select private.nivel_de((select auth.uid()), 'contabilidad') <> 'no'
      or private.is_service();
$$;

comment on function private.ve_contabilidad is
  'Quién puede LEER el libro: admin y contabilidad por rol, más quien tenga el '
  'permiso «contabilidad» abierto a mano (aunque sea solo lectura). Es la '
  'misma regla que decide si la sección aparece en el panel: una sola verdad.';

grant execute on function private.ve_contabilidad() to authenticated;

-- El filtro no depende de ninguna columna, así que Postgres lo evalúa UNA vez
-- por consulta, no por fila.
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
 where private.ve_contabilidad()
 group by d.project_id, d.cuenta, c.name, c.kind, c.sort_order, c.codigo_plan, c.code;

create or replace view public.v_libro_mayor_movimientos as
select * from (
  select d.project_id,
         d.cuenta,
         coalesce(c.codigo_plan, c.code) as codigo,
         c.name as cuenta_nombre,
         c.kind as tipo,
         c.sort_order,
         d.fecha,
         d.comprobante,
         d.origen,
         d.origen_id,
         d.glosa,
         d.debe,
         d.haber,
         round(sum(case when c.kind in ('activo','gasto','orden_deudora')
                        then d.debe - d.haber
                        else d.haber - d.debe end)
               over (partition by d.cuenta
                     order by d.fecha, d.comprobante, d.registrado_en, d.debe desc
                     rows between unbounded preceding and current row), 2) as saldo,
         d.centro_costo,
         d.cliente,
         d.titular,
         d.titular_nombre,
         d.registrado_en,
         d.modificado_en,
         d.usuario_id,
         d.usuario,
         d.moneda,
         d.tipo_cambio,
         d.monto_origen,
         round(sum(case when c.kind in ('activo','gasto','orden_deudora')
                        then d.debe - d.haber
                        else d.haber - d.debe end)
               over (partition by d.project_id, d.cuenta
                     order by d.fecha, d.comprobante, d.registrado_en, d.debe desc
                     rows between unbounded preceding and current row), 2) as saldo_urbanizacion
    from public.v_libro_diario d
    join public.chart_of_accounts c on c.code = d.cuenta
) m
 where private.ve_contabilidad();

alter view public.v_libro_mayor_movimientos set (security_invoker = true);

create or replace view public.v_comprobantes as
select d.project_id,
       p.name as proyecto,
       d.comprobante as numero,
       d.origen,
       d.origen_id,
       case d.origen
         when 'comprobante' then 'Comprobante manual'
         when 'egreso'      then 'Comprobante de egreso'
         when 'venta'       then 'Venta'
         when 'pago'        then 'Recibo de cobro'
         when 'terreno'     then 'Compra de terreno'
         else initcap(d.origen)
       end as tipo,
       min(d.fecha) as fecha,
       min(d.glosa) as glosa,
       count(*) as lineas,
       sum(d.debe) as debe,
       sum(d.haber) as haber,
       round(sum(d.debe) - sum(d.haber), 2) as diferencia,
       max(d.registrado_en) as registrado_en,
       max(d.modificado_en) as modificado_en,
       min(d.usuario_id::text)::uuid as usuario_id,
       min(d.usuario) as usuario,
       min(d.moneda) as moneda,
       max(d.tipo_cambio) as tipo_cambio,
       min(d.centro_costo) as centro_costo,
       min(d.cliente) as cliente,
       d.origen = 'comprobante' as es_manual
  from public.v_libro_diario d
  join public.projects p on p.id = d.project_id
 where private.ve_contabilidad()
 group by d.project_id, p.name, d.comprobante, d.origen, d.origen_id;

alter view public.v_comprobantes set (security_invoker = true);
