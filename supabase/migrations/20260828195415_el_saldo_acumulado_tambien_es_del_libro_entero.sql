-- El saldo acumulado del mayor venía partido por urbanización, así que en la
-- vista consolidada tres ventas del mismo día en tres urbanizaciones daban
-- 35.000, 55.000 y 50.000 en vez de 35.000, 90.000 y 140.000: tres mayores
-- entrelazados haciéndose pasar por uno.
--
-- Si el libro es uno, el mayor de la 1.02.01.010 es el de la EMPRESA. Van las
-- dos columnas, porque las dos lecturas son legítimas y cada una sirve para
-- algo distinto:
--
--   · `saldo`              — el del libro entero. Es el que se mira en
--                            consolidado y el que cuadra contra el balance de
--                            la sociedad.
--   · `saldo_urbanizacion` — el de la cuenta dentro de UNA urbanización. Es el
--                            único correcto cuando la consulta ya filtró por
--                            project_id, porque su partición coincide con el
--                            filtro; el otro quedaría con huecos.
--
-- La pantalla elige según esté consolidada o parada en una urbanización.
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
  join public.chart_of_accounts c on c.code = d.cuenta;

alter view public.v_libro_mayor_movimientos set (security_invoker = true);

comment on view public.v_libro_mayor_movimientos is
  'El mayor como cuenta abierta: cada movimiento con su comprobante, su '
  'bitácora (registro, modificación, usuario, tipo de cambio) y el saldo '
  'acumulado. `saldo` acumula sobre el libro entero; `saldo_urbanizacion` '
  'sobre una sola urbanización — se usa esta cuando la consulta filtra por '
  'project_id, porque la otra quedaría con huecos.';
