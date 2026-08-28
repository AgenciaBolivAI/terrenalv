-- EL REGISTRO DE COMPROBANTES, COMPLETO.
--
-- Se arma DESDE el diario, no en paralelo: así el registro y el libro no
-- pueden discrepar nunca —si un movimiento está en el libro, su comprobante
-- está acá, con el mismo número y el mismo importe—. Lo contrario (una tabla
-- de comprobantes que se llena aparte) es exactamente lo que estaba roto: el
-- registro mostraba solo los asientos manuales y el resto del libro no tenía
-- comprobante que lo respaldara.
--
-- `origen` + `origen_id` es el enlace al documento: la pantalla sabe que un
-- 'egreso' se abre en /admin/egreso/{id} y una 'venta' en su reserva.

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
 group by d.project_id, p.name, d.comprobante, d.origen, d.origen_id;

alter view public.v_comprobantes set (security_invoker = true);

comment on view public.v_comprobantes is
  'Todos los comprobantes: los manuales y los que arma el sistema (egresos, '
  'ventas, cobros, compras de terreno). Sale del propio libro diario, así que '
  'el registro y el libro dicen siempre lo mismo.';

-- ---------------------------------------------------------------------------
-- EL MAYOR, MOVIMIENTO A MOVIMIENTO.
--
-- `v_libro_mayor` da los totales por cuenta —sirve para el balance— pero un
-- mayor de verdad es la cuenta abierta: cada movimiento con su fecha, su
-- comprobante, su glosa, y el SALDO ACUMULADO después de cada uno. Sin eso no
-- hay punteo ni conciliación posible.
-- ---------------------------------------------------------------------------
create or replace view public.v_libro_mayor_movimientos as
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
       -- El saldo acumulado, con el signo de la naturaleza de la cuenta.
       round(sum(case when c.kind in ('activo','gasto','orden_deudora')
                      then d.debe - d.haber
                      else d.haber - d.debe end)
             over (partition by d.project_id, d.cuenta
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
       d.monto_origen
  from public.v_libro_diario d
  join public.chart_of_accounts c on c.code = d.cuenta;

alter view public.v_libro_mayor_movimientos set (security_invoker = true);

comment on view public.v_libro_mayor_movimientos is
  'El mayor como cuenta abierta: cada movimiento con su comprobante, su '
  'bitácora (registro, modificación, usuario, tipo de cambio) y el saldo '
  'acumulado después de cada asiento.';

grant select on public.v_comprobantes, public.v_libro_mayor_movimientos to authenticated;
revoke all on public.v_comprobantes, public.v_libro_mayor_movimientos from anon;
