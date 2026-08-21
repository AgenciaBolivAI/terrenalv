-- El libro diario ahora reconoce la VENTA, no solo la plata.
--
-- Antes solo proyectaba movimientos de caja: un cobro de cuota entraba como
-- "debe Caja / haber Cuentas por Cobrar". Con eso la cuenta por cobrar bajaba
-- sin haber subido nunca (quedaba en negativo), Ventas de Terrenos daba cero
-- siempre, y el Estado de Resultados mostraba solo gastos. Una empresa que
-- vendió lotes por Bs 36.000 aparecía con pérdida.
--
-- Falta el asiento de la venta. Cuando la venta se confirma:
--   debe  1131 Cuentas por Cobrar     precio pactado
--   haber 4111 Ventas de Terrenos     precio pactado
-- y cada pago posterior baja esa cuenta por cobrar contra caja.
--
-- Un pago sobre una reserva TODAVÍA NO confirmada no es una venta: es plata que
-- se le debe al comprador hasta que la operación cierre, así que va a Anticipos
-- de Clientes (pasivo). Al confirmarse, la venta entra completa y los pagos ya
-- cobrados quedan aplicados contra la cuenta por cobrar.
create or replace view public.v_libro_diario
with (security_invoker = on) as

-- 1. La venta: se reconoce el ingreso el día que se confirma.
select
  r.project_id,
  (r.confirmed_at at time zone 'America/La_Paz')::date         as fecha,
  'VTA-' || r.tracking_code                                     as comprobante,
  'Venta de lote — ' || r.buyer_full_name                       as glosa,
  '1131'::text                                                  as cuenta,
  r.price_agreed                                                as debe,
  0::numeric                                                    as haber,
  r.id                                                          as origen_id,
  'venta'::text                                                 as origen
from public.reservations r
where r.confirmed_at is not null

union all

select
  r.project_id,
  (r.confirmed_at at time zone 'America/La_Paz')::date,
  'VTA-' || r.tracking_code,
  'Venta de lote — ' || r.buyer_full_name,
  '4111',
  0::numeric,
  r.price_agreed,
  r.id,
  'venta'
from public.reservations r
where r.confirmed_at is not null

union all

-- 2. La plata que entra.
select
  p.project_id,
  (p.verified_at at time zone 'America/La_Paz')::date,
  'PAGO-' || p.reference_code,
  case when p.purpose = 'cuota' then 'Cobro de cuota' else 'Cobro de seña / reserva' end
    || ' — ' || r.buyer_full_name || ' (' || r.tracking_code || ')',
  '1111',
  p.amount_bob,
  0::numeric,
  p.id,
  'pago'
from public.payments p
join public.reservations r on r.id = p.reservation_id
where p.status = 'aprobado' and p.verified_at is not null

union all

select
  p.project_id,
  (p.verified_at at time zone 'America/La_Paz')::date,
  'PAGO-' || p.reference_code,
  case when p.purpose = 'cuota' then 'Cobro de cuota' else 'Cobro de seña / reserva' end
    || ' — ' || r.buyer_full_name || ' (' || r.tracking_code || ')',
  -- Contra qué se cobra: si la venta ya está confirmada baja la cuenta por
  -- cobrar; si todavía no, es plata que se le debe al comprador.
  case when r.confirmed_at is not null then '1131' else '2131' end,
  0::numeric,
  p.amount_bob,
  p.id,
  'pago'
from public.payments p
join public.reservations r on r.id = p.reservation_id
where p.status = 'aprobado' and p.verified_at is not null

union all

-- 3. La plata que sale.
select
  e.project_id,
  e.incurred_on,
  'EGR-' || left(replace(e.id::text, '-', ''), 10),
  e.description || coalesce(' — ' || e.supplier, ''),
  case e.category
    when 'obra'           then '5111'
    when 'comisiones'     then '5211'
    when 'sueldos'        then '5221'
    when 'publicidad'     then '5311'
    when 'administracion' then '5411'
    when 'impuestos'      then '5511'
    when 'financiero'     then '5611'
    else '5911'
  end,
  e.amount_bob,
  0::numeric,
  e.id,
  'egreso'
from public.expenses e
where e.deleted_at is null

union all

select
  e.project_id,
  e.incurred_on,
  'EGR-' || left(replace(e.id::text, '-', ''), 10),
  e.description || coalesce(' — ' || e.supplier, ''),
  '1111',
  0::numeric,
  e.amount_bob,
  e.id,
  'egreso'
from public.expenses e
where e.deleted_at is null;
