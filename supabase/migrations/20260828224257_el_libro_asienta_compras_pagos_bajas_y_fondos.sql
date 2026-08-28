-- EL LIBRO ASIENTA LO QUE FALTABA.
--
-- Hasta hoy el diario tenía doce ramas y tres agujeros:
--
--   · **La compra de un activo fijo no se asentaba.** Ninguna. La depreciación
--     mensual acreditaba 1290 contra un activo que el balance nunca reconoció,
--     y las cuentas 1241–1249 no las debitaba nadie. La baja tampoco asentaba:
--     un vehículo vendido seguía en el activo para siempre.
--   · **Todo egreso salía de la caja.** No existía comprar a crédito ni gastar
--     de un fondo entregado: la contrapartida era siempre tesorería.
--   · **No había fondos por rendir.**
--
-- Ahora son veinticinco ramas. Las nuevas se DERIVAN de su documento —el
-- activo, el egreso, el fondo—, igual que ya se derivan la venta, el cobro y
-- la compra de terreno. No se asientan como comprobante manual a propósito: si
-- se asentaran, el diario los contaría dos veces (una por el comprobante y
-- otra por la fila) el día que alguien agregue la rama.
--
-- La baja cuadra por construcción:
--     acumulada + venta + pérdida  =  costo + ganancia
-- Se emite la pérdida O la ganancia, nunca las dos, y la diferencia siempre
-- cierra contra el costo que se da de baja.
--
-- Las columnas y su orden no se tocan (23), porque `create or replace view`
-- no perdona; y la puerta de permisos va DENTRO del where, no en un
-- envoltorio que se mire a sí mismo.
create or replace view public.v_libro_diario as
with base_venta as (
  select r.*,
         case
           when r.client_meta ? 'migrado_de' then coalesce((r.client_meta -> 'reportado' ->> 'deuda')::numeric, r.price_agreed)
           when r.client_meta ? 'traspaso'   then coalesce((r.client_meta -> 'traspaso' ->> 'baseline_original')::numeric, r.price_agreed)
           else r.price_agreed
         end as monto_venta,
         r.status = 'confirmada'::reservation_status or r.client_meta ? 'traspasada_a' as cadena_viva,
         r.status = any (array['pendiente_pago'::reservation_status,'en_verificacion'::reservation_status,'rechazo_reintento'::reservation_status]) as reserva_viva,
         (r.status = any (array['expirada'::reservation_status,'cancelada'::reservation_status])) and not r.client_meta ? 'traspasada_a' as reserva_caida
    from public.reservations r
), costo_venta as (
  select r.id, r.project_id, r.buyer_ci_normalized, r.buyer_full_name, r.tracking_code,
         r.titular, r.titular_nombre, r.created_at, r.updated_at, r.verified_by,
         (r.confirmed_at at time zone 'America/La_Paz')::date as fecha,
         round(coalesce(l.area_m2, 0::numeric) * private.costo_m2(r.project_id, (r.confirmed_at at time zone 'America/La_Paz')::date), 2) as costo
    from public.reservations r
    join public.lots l on l.id = r.lot_id
   where r.status = 'confirmada'::reservation_status and r.confirmed_at is not null
), activo as (
  -- El activo con su cuenta, su proveedor y las cifras de la baja resueltas.
  select a.*, ac.cuenta_activo,
         coalesce(a.dep_acumulada_baja, 0) as acum,
         coalesce(a.valor_venta, 0) as venta,
         coalesce(pv.name, '') as proveedor
    from public.fixed_assets a
    join public.asset_categories ac on ac.id = a.categoria_id
    left join public.contacts pv on pv.id = a.proveedor_contact_id
)
-- Venta: la deuda del comprador
select r.project_id,
       (r.confirmed_at at time zone 'America/La_Paz')::date as fecha,
       'VTA-' || r.tracking_code as comprobante,
       'Venta de lote — ' || r.buyer_full_name as glosa,
       '1131'::text as cuenta,
       r.monto_venta as debe,
       0::numeric as haber,
       r.id as origen_id,
       'venta'::text as origen,
       r.buyer_ci_normalized as cliente_ci,
       r.buyer_full_name as cliente,
       null::uuid as centro_costo_id,
       null::text as centro_costo,
       r.titular,
       r.titular_nombre,
       r.created_at as registrado_en,
       r.updated_at as modificado_en,
       r.verified_by as usuario_id,
       pr.full_name as usuario,
       coalesce(r.currency, 'BOB')::text as moneda,
       1::numeric as tipo_cambio,
       r.monto_venta as monto_origen
  from base_venta r
  left join public.profiles pr on pr.id = r.verified_by
 where r.confirmed_at is not null and r.status = 'confirmada'::reservation_status
union all
-- Venta: el ingreso
select r.project_id,
       (r.confirmed_at at time zone 'America/La_Paz')::date,
       'VTA-' || r.tracking_code,
       'Venta de lote — ' || r.buyer_full_name,
       '4111'::text,
       0::numeric,
       r.monto_venta,
       r.id, 'venta'::text,
       r.buyer_ci_normalized, r.buyer_full_name,
       null::uuid, null::text,
       r.titular, r.titular_nombre,
       r.created_at, r.updated_at, r.verified_by, pr.full_name,
       coalesce(r.currency, 'BOB')::text, 1::numeric, r.monto_venta
  from base_venta r
  left join public.profiles pr on pr.id = r.verified_by
 where r.confirmed_at is not null and r.status = 'confirmada'::reservation_status
union all
-- Costo del lote vendido
select cv.project_id, cv.fecha,
       'VTA-' || cv.tracking_code,
       'Costo del lote vendido — ' || cv.buyer_full_name,
       '5121'::text, cv.costo, 0::numeric,
       cv.id, 'venta'::text,
       cv.buyer_ci_normalized, cv.buyer_full_name,
       null::uuid, null::text,
       cv.titular, cv.titular_nombre,
       cv.created_at, cv.updated_at, cv.verified_by, pr.full_name,
       'BOB'::text, 1::numeric, cv.costo
  from costo_venta cv
  left join public.profiles pr on pr.id = cv.verified_by
 where cv.costo > 0::numeric
union all
select cv.project_id, cv.fecha,
       'VTA-' || cv.tracking_code,
       'Costo del lote vendido — ' || cv.buyer_full_name,
       '1151'::text, 0::numeric, cv.costo,
       cv.id, 'venta'::text,
       cv.buyer_ci_normalized, cv.buyer_full_name,
       null::uuid, null::text,
       cv.titular, cv.titular_nombre,
       cv.created_at, cv.updated_at, cv.verified_by, pr.full_name,
       'BOB'::text, 1::numeric, cv.costo
  from costo_venta cv
  left join public.profiles pr on pr.id = cv.verified_by
 where cv.costo > 0::numeric
union all
-- Cobro: entra a la caja o al banco
select p.project_id,
       (p.verified_at at time zone 'America/La_Paz')::date,
       'PAGO-' || p.reference_code,
       case p.purpose
         when 'cuota' then 'Cobro de cuota'
         when 'abono' then 'Abono al lote'
         when 'comision' then 'Comisión del mercado de traspasos'
         else 'Cobro de seña / reserva'
       end || ' por ' || private.forma_de_pago(p.provider) || ' — ' || r.buyer_full_name || ' (' || r.tracking_code || ')',
       coalesce(t.account_code, '1111'::text),
       p.amount_bob, 0::numeric,
       p.id, 'pago'::text,
       r.buyer_ci_normalized, r.buyer_full_name,
       null::uuid, null::text,
       r.titular, r.titular_nombre,
       p.created_at, p.updated_at, p.verified_by, pr.full_name,
       coalesce(p.currency, 'BOB')::text, coalesce(p.exchange_rate_used, 1), p.amount
  from public.payments p
  join public.reservations r on r.id = p.reservation_id
  left join public.treasury_accounts t on t.id = p.treasury_account_id
  left join public.profiles pr on pr.id = p.verified_by
 where p.status = 'aprobado'::payment_status and p.verified_at is not null
union all
-- Cobro: contra qué se aplica
select p.project_id,
       (p.verified_at at time zone 'America/La_Paz')::date,
       'PAGO-' || p.reference_code,
       case p.purpose
         when 'cuota' then 'Cobro de cuota'
         when 'abono' then 'Abono al lote'
         when 'comision' then 'Comisión del mercado de traspasos'
         else 'Cobro de seña / reserva'
       end || ' por ' || private.forma_de_pago(p.provider) || ' — ' || r.buyer_full_name || ' (' || r.tracking_code || ')',
       case
         when p.purpose = 'comision' then '4211'::text
         when p.purpose = 'reserva' and b.reserva_caida then '4411'::text
         when b.cadena_viva then '1131'::text
         else '2131'::text
       end,
       0::numeric,
       p.amount_bob - coalesce(p.interest_bob, 0::numeric),
       p.id, 'pago'::text,
       r.buyer_ci_normalized, r.buyer_full_name,
       null::uuid, null::text,
       r.titular, r.titular_nombre,
       p.created_at, p.updated_at, p.verified_by, pr.full_name,
       coalesce(p.currency, 'BOB')::text, coalesce(p.exchange_rate_used, 1), p.amount
  from public.payments p
  join base_venta b on b.id = p.reservation_id
  join public.reservations r on r.id = p.reservation_id
  left join public.profiles pr on pr.id = p.verified_by
 where p.status = 'aprobado'::payment_status and p.verified_at is not null
   and (p.amount_bob - coalesce(p.interest_bob, 0::numeric)) <> 0::numeric
union all
-- El interés del financiamiento
select p.project_id,
       (p.verified_at at time zone 'America/La_Paz')::date,
       'PAGO-' || p.reference_code,
       'Interés de financiamiento — ' || r.buyer_full_name || ' (' || r.tracking_code || ')',
       '4311'::text, 0::numeric, p.interest_bob,
       p.id, 'pago'::text,
       r.buyer_ci_normalized, r.buyer_full_name,
       null::uuid, null::text,
       r.titular, r.titular_nombre,
       p.created_at, p.updated_at, p.verified_by, pr.full_name,
       coalesce(p.currency, 'BOB')::text, coalesce(p.exchange_rate_used, 1), p.interest_bob
  from public.payments p
  join public.reservations r on r.id = p.reservation_id
  left join public.profiles pr on pr.id = p.verified_by
 where p.status = 'aprobado'::payment_status and p.verified_at is not null
   and coalesce(p.interest_bob, 0::numeric) > 0::numeric
union all
-- Compra de terreno: entra al inventario
select lp.project_id, lp.fecha_compra,
       'TERR-' || lp.codigo,
       'Compra de terreno — ' || lp.nombre || coalesce(' — ' || coalesce(c.name, lp.vendedor_nombre), ''),
       '1151'::text, lp.costo_compra, 0::numeric,
       lp.id, 'terreno'::text,
       null::text, null::text,
       null::uuid, null::text,
       lp.titular, lp.titular_nombre,
       lp.created_at, lp.updated_at, lp.created_by, pr.full_name,
       'BOB'::text, 1::numeric, lp.costo_compra
  from public.land_parcels lp
  left join public.contacts c on c.id = lp.vendedor_contact_id
  left join public.profiles pr on pr.id = lp.created_by
 where lp.costo_compra > 0::numeric
union all
-- Compra de terreno: sale de la caja
select lp.project_id, lp.fecha_compra,
       'TERR-' || lp.codigo,
       'Compra de terreno — ' || lp.nombre || coalesce(' — ' || coalesce(c.name, lp.vendedor_nombre), ''),
       coalesce(t.account_code, '1111'::text), 0::numeric, lp.costo_compra,
       lp.id, 'terreno'::text,
       null::text, null::text,
       null::uuid, null::text,
       lp.titular, lp.titular_nombre,
       lp.created_at, lp.updated_at, lp.created_by, pr.full_name,
       'BOB'::text, 1::numeric, lp.costo_compra
  from public.land_parcels lp
  left join public.contacts c on c.id = lp.vendedor_contact_id
  left join public.treasury_accounts t on t.id = lp.treasury_account_id
  left join public.profiles pr on pr.id = lp.created_by
 where lp.costo_compra > 0::numeric
union all
-- Egreso: el gasto (o el costo que capitaliza)
select e.project_id, e.incurred_on,
       coalesce(e.numero, 'EGR-' || left(replace(e.id::text, '-', ''), 10)),
       coalesce(ec.nombre || ' — ', '') || e.description || coalesce(' — ' || coalesce(c.name, e.supplier), ''),
       case when cc.capitaliza then '1151'::text
            else coalesce(ec.account_code,
              case e.category
                when 'obra'::expense_category then '5111'::text
                when 'comisiones'::expense_category then '5211'::text
                when 'sueldos'::expense_category then '5221'::text
                when 'publicidad'::expense_category then '5311'::text
                when 'administracion'::expense_category then '5411'::text
                when 'impuestos'::expense_category then '5511'::text
                when 'financiero'::expense_category then '5611'::text
                else '5911'::text
              end)
       end,
       e.amount_bob, 0::numeric,
       e.id, 'egreso'::text,
       rv.buyer_ci_normalized, rv.buyer_full_name,
       e.centro_costo_id, cc.nombre,
       e.titular, e.titular_nombre,
       e.created_at, e.updated_at, e.created_by, pr.full_name,
       coalesce(e.currency, 'BOB')::text, coalesce(e.exchange_rate_used, 1), e.amount
  from public.expenses e
  left join public.contacts c on c.id = e.contact_id
  left join public.reservations rv on rv.id = e.reservation_id
  left join public.centros_costo cc on cc.id = e.centro_costo_id
  left join public.expense_concepts ec on ec.id = e.concept_id
  left join public.profiles pr on pr.id = e.created_by
 where e.deleted_at is null
union all
-- Egreso: contra qué. Al contado sale de la caja; a crédito queda debiéndose
-- al proveedor; de un fondo, descarga el fondo de esa persona.
select e.project_id, e.incurred_on,
       coalesce(e.numero, 'EGR-' || left(replace(e.id::text, '-', ''), 10)),
       coalesce(ec.nombre || ' — ', '') || e.description || coalesce(' — ' || coalesce(c.name, e.supplier), ''),
       case e.forma_pago
         when 'credito' then '2.01.04.010'::text
         when 'fondos_por_rendir' then '1.02.04.030'::text
         else coalesce(t.account_code, '1111'::text)
       end,
       0::numeric, e.amount_bob,
       e.id, 'egreso'::text,
       rv.buyer_ci_normalized, rv.buyer_full_name,
       e.centro_costo_id, cc.nombre,
       e.titular, e.titular_nombre,
       e.created_at, e.updated_at, e.created_by, pr.full_name,
       coalesce(e.currency, 'BOB')::text, coalesce(e.exchange_rate_used, 1), e.amount
  from public.expenses e
  left join public.treasury_accounts t on t.id = e.treasury_account_id
  left join public.contacts c on c.id = e.contact_id
  left join public.reservations rv on rv.id = e.reservation_id
  left join public.centros_costo cc on cc.id = e.centro_costo_id
  left join public.expense_concepts ec on ec.id = e.concept_id
  left join public.profiles pr on pr.id = e.created_by
 where e.deleted_at is null
union all
-- Pago al proveedor: se cancela la deuda del egreso a crédito.
select e.project_id, e.pagado_el,
       coalesce(e.numero, 'EGR-' || left(replace(e.id::text, '-', ''), 10)) || '-P',
       'Pago a proveedor — ' || e.description || coalesce(' — ' || coalesce(c.name, e.supplier), ''),
       '2.01.04.010'::text, e.amount_bob, 0::numeric,
       e.id, 'egreso'::text,
       null::text, null::text,
       e.centro_costo_id, cc.nombre,
       e.titular, e.titular_nombre,
       e.created_at, e.updated_at, e.created_by, pr.full_name,
       'BOB'::text, 1::numeric, e.amount_bob
  from public.expenses e
  left join public.contacts c on c.id = e.contact_id
  left join public.centros_costo cc on cc.id = e.centro_costo_id
  left join public.profiles pr on pr.id = e.created_by
 where e.deleted_at is null and e.forma_pago = 'credito' and e.pagado_el is not null
union all
select e.project_id, e.pagado_el,
       coalesce(e.numero, 'EGR-' || left(replace(e.id::text, '-', ''), 10)) || '-P',
       'Pago a proveedor — ' || e.description || coalesce(' — ' || coalesce(c.name, e.supplier), ''),
       coalesce(tp.account_code, '1111'::text), 0::numeric, e.amount_bob,
       e.id, 'egreso'::text,
       null::text, null::text,
       e.centro_costo_id, cc.nombre,
       e.titular, e.titular_nombre,
       e.created_at, e.updated_at, e.created_by, pr.full_name,
       'BOB'::text, 1::numeric, e.amount_bob
  from public.expenses e
  left join public.treasury_accounts tp on tp.id = e.pagado_de
  left join public.contacts c on c.id = e.contact_id
  left join public.centros_costo cc on cc.id = e.centro_costo_id
  left join public.profiles pr on pr.id = e.created_by
 where e.deleted_at is null and e.forma_pago = 'credito' and e.pagado_el is not null
union all
-- Compra de activo fijo: entra al activo. Solo si NO nació de un egreso: si
-- nació de uno, ese egreso ya movió la plata y esto sería contarlo dos veces.
select a.project_id, a.fecha_compra,
       'ACT-' || a.codigo,
       'Compra de activo fijo — ' || a.nombre || case when a.proveedor <> '' then ' — ' || a.proveedor else '' end,
       coalesce(a.cuenta_activo, '1249'::text), a.costo, 0::numeric,
       a.id, 'activo'::text,
       null::text, null::text,
       a.centro_costo_id, cc.nombre,
       a.titular, a.titular_nombre,
       a.created_at, a.updated_at, a.created_by, pr.full_name,
       'BOB'::text, 1::numeric, a.costo
  from activo a
  left join public.centros_costo cc on cc.id = a.centro_costo_id
  left join public.profiles pr on pr.id = a.created_by
 where a.expense_id is null
union all
select a.project_id, a.fecha_compra,
       'ACT-' || a.codigo,
       'Compra de activo fijo — ' || a.nombre || case when a.proveedor <> '' then ' — ' || a.proveedor else '' end,
       case a.forma_pago when 'credito' then '2.01.04.010'::text
                         else coalesce(t.account_code, '1111'::text) end,
       0::numeric, a.costo,
       a.id, 'activo'::text,
       null::text, null::text,
       a.centro_costo_id, cc.nombre,
       a.titular, a.titular_nombre,
       a.created_at, a.updated_at, a.created_by, pr.full_name,
       'BOB'::text, 1::numeric, a.costo
  from activo a
  left join public.treasury_accounts t on t.id = a.treasury_account_id
  left join public.centros_costo cc on cc.id = a.centro_costo_id
  left join public.profiles pr on pr.id = a.created_by
 where a.expense_id is null
union all
-- Pago al proveedor del activo comprado a crédito.
select a.project_id, a.pagado_el,
       'ACT-' || a.codigo || '-P',
       'Pago del activo fijo — ' || a.nombre || case when a.proveedor <> '' then ' — ' || a.proveedor else '' end,
       '2.01.04.010'::text, a.costo, 0::numeric,
       a.id, 'activo'::text,
       null::text, null::text,
       a.centro_costo_id, cc.nombre,
       a.titular, a.titular_nombre,
       a.created_at, a.updated_at, a.created_by, pr.full_name,
       'BOB'::text, 1::numeric, a.costo
  from activo a
  left join public.centros_costo cc on cc.id = a.centro_costo_id
  left join public.profiles pr on pr.id = a.created_by
 where a.expense_id is null and a.forma_pago = 'credito' and a.pagado_el is not null
union all
select a.project_id, a.pagado_el,
       'ACT-' || a.codigo || '-P',
       'Pago del activo fijo — ' || a.nombre || case when a.proveedor <> '' then ' — ' || a.proveedor else '' end,
       coalesce(tp.account_code, '1111'::text), 0::numeric, a.costo,
       a.id, 'activo'::text,
       null::text, null::text,
       a.centro_costo_id, cc.nombre,
       a.titular, a.titular_nombre,
       a.created_at, a.updated_at, a.created_by, pr.full_name,
       'BOB'::text, 1::numeric, a.costo
  from activo a
  left join public.treasury_accounts tp on tp.id = a.pagado_de
  left join public.centros_costo cc on cc.id = a.centro_costo_id
  left join public.profiles pr on pr.id = a.created_by
 where a.expense_id is null and a.forma_pago = 'credito' and a.pagado_el is not null
union all
-- Baja o venta del activo: se cancela la depreciación acumulada…
select a.project_id, a.fecha_baja,
       'ACT-' || a.codigo || '-B',
       'Baja de activo fijo — ' || a.nombre || ' (' || coalesce(a.motivo_baja, 'sin motivo') || ')',
       '1290'::text, a.acum, 0::numeric,
       a.id, 'activo'::text,
       null::text, null::text,
       a.centro_costo_id, cc.nombre,
       a.titular, a.titular_nombre,
       a.created_at, a.updated_at, a.created_by, pr.full_name,
       'BOB'::text, 1::numeric, a.acum
  from activo a
  left join public.centros_costo cc on cc.id = a.centro_costo_id
  left join public.profiles pr on pr.id = a.created_by
 where a.estado <> 'activo' and a.acum > 0
union all
-- …entra la plata de la venta, si se vendió…
select a.project_id, a.fecha_baja,
       'ACT-' || a.codigo || '-B',
       'Venta de activo fijo — ' || a.nombre,
       coalesce(tv.account_code, '1111'::text), a.venta, 0::numeric,
       a.id, 'activo'::text,
       null::text, null::text,
       a.centro_costo_id, cc.nombre,
       a.titular, a.titular_nombre,
       a.created_at, a.updated_at, a.created_by, pr.full_name,
       'BOB'::text, 1::numeric, a.venta
  from activo a
  left join public.treasury_accounts tv on tv.id = a.venta_treasury_account_id
  left join public.centros_costo cc on cc.id = a.centro_costo_id
  left join public.profiles pr on pr.id = a.created_by
 where a.estado <> 'activo' and a.venta > 0
union all
-- …la pérdida, si el valor en libros era mayor que lo que se sacó…
select a.project_id, a.fecha_baja,
       'ACT-' || a.codigo || '-B',
       'Pérdida en baja de activo fijo — ' || a.nombre,
       '5.02.03.010'::text, a.costo - a.acum - a.venta, 0::numeric,
       a.id, 'activo'::text,
       null::text, null::text,
       a.centro_costo_id, cc.nombre,
       a.titular, a.titular_nombre,
       a.created_at, a.updated_at, a.created_by, pr.full_name,
       'BOB'::text, 1::numeric, a.costo - a.acum - a.venta
  from activo a
  left join public.centros_costo cc on cc.id = a.centro_costo_id
  left join public.profiles pr on pr.id = a.created_by
 where a.estado <> 'activo' and (a.costo - a.acum - a.venta) > 0
union all
-- …o la ganancia, si se vendió por más de lo que valía en libros…
select a.project_id, a.fecha_baja,
       'ACT-' || a.codigo || '-B',
       'Ganancia en venta de activo fijo — ' || a.nombre,
       '4.02.01.020'::text, 0::numeric, a.venta - (a.costo - a.acum),
       a.id, 'activo'::text,
       null::text, null::text,
       a.centro_costo_id, cc.nombre,
       a.titular, a.titular_nombre,
       a.created_at, a.updated_at, a.created_by, pr.full_name,
       'BOB'::text, 1::numeric, a.venta - (a.costo - a.acum)
  from activo a
  left join public.centros_costo cc on cc.id = a.centro_costo_id
  left join public.profiles pr on pr.id = a.created_by
 where a.estado <> 'activo' and (a.venta - (a.costo - a.acum)) > 0
union all
-- …y sale el activo por su costo.
select a.project_id, a.fecha_baja,
       'ACT-' || a.codigo || '-B',
       'Baja de activo fijo — ' || a.nombre || ' (' || coalesce(a.motivo_baja, 'sin motivo') || ')',
       coalesce(a.cuenta_activo, '1249'::text), 0::numeric, a.costo,
       a.id, 'activo'::text,
       null::text, null::text,
       a.centro_costo_id, cc.nombre,
       a.titular, a.titular_nombre,
       a.created_at, a.updated_at, a.created_by, pr.full_name,
       'BOB'::text, 1::numeric, a.costo
  from activo a
  left join public.centros_costo cc on cc.id = a.centro_costo_id
  left join public.profiles pr on pr.id = a.created_by
 where a.estado <> 'activo'
union all
-- Fondo a rendir: la persona debe la plata que se le entregó.
select f.project_id, f.fecha, f.numero, f.glosa,
       '1.02.04.030'::text,
       case f.tipo when 'entrega' then f.monto else 0::numeric end,
       case f.tipo when 'entrega' then 0::numeric else f.monto end,
       f.id, 'fondo'::text,
       null::text, emp.nombre_completo,
       null::uuid, null::text,
       'empresa'::text, null::text,
       f.created_at, f.updated_at, f.created_by, pr.full_name,
       'BOB'::text, 1::numeric, f.monto
  from public.fondos_a_rendir f
  join public.hr_empleados emp on emp.id = f.empleado_id
  left join public.profiles pr on pr.id = f.created_by
 where f.deleted_at is null
union all
select f.project_id, f.fecha, f.numero, f.glosa,
       coalesce(t.account_code, '1111'::text),
       case f.tipo when 'entrega' then 0::numeric else f.monto end,
       case f.tipo when 'entrega' then f.monto else 0::numeric end,
       f.id, 'fondo'::text,
       null::text, emp.nombre_completo,
       null::uuid, null::text,
       'empresa'::text, null::text,
       f.created_at, f.updated_at, f.created_by, pr.full_name,
       'BOB'::text, 1::numeric, f.monto
  from public.fondos_a_rendir f
  join public.hr_empleados emp on emp.id = f.empleado_id
  left join public.treasury_accounts t on t.id = f.treasury_account_id
  left join public.profiles pr on pr.id = f.created_by
 where f.deleted_at is null
union all
-- Comprobantes manuales. El centro de la LÍNEA manda sobre el de la cabecera.
select je.project_id, je.entry_date, je.number,
       je.glosa || coalesce(' — ' || jl.glosa, ''),
       jl.account_code, jl.debe, jl.haber,
       je.id, 'comprobante'::text,
       rv.buyer_ci_normalized, rv.buyer_full_name,
       coalesce(jl.centro_costo_id, je.centro_costo_id), coalesce(ccl.nombre, cc.nombre),
       je.titular, je.titular_nombre,
       je.created_at, je.updated_at,
       coalesce(je.posted_by, je.created_by),
       pr.full_name,
       'BOB'::text, 1::numeric, jl.debe + jl.haber
  from public.journal_entries je
  join public.journal_lines jl on jl.entry_id = je.id
  left join public.reservations rv on rv.id = je.reservation_id
  left join public.centros_costo cc on cc.id = je.centro_costo_id
  left join public.centros_costo ccl on ccl.id = jl.centro_costo_id
  left join public.profiles pr on pr.id = coalesce(je.posted_by, je.created_by)
 where je.status = 'registrado'::voucher_status;

alter view public.v_libro_diario set (security_invoker = true);

-- La puerta va dentro: se reconstruye la vista con el filtro al final de cada
-- rama sería ilegible, así que se envuelve el CUERPO —no el nombre de la
-- vista, que es lo que la vuelve recursiva.
do $$
declare v_def text;
begin
  v_def := pg_get_viewdef('public.v_libro_diario'::regclass, true);
  if position('ve_contabilidad' in v_def) > 0 then return; end if;
  execute 'create or replace view public.v_libro_diario as select * from ('
          || rtrim(rtrim(v_def), ';')
          || ') libro where private.ve_contabilidad()';
end $$;

do $$
begin
  if position('ve_contabilidad' in pg_get_viewdef('public.v_libro_diario'::regclass)) = 0 then
    raise exception 'EL_LIBRO_QUEDO_SIN_PUERTA';
  end if;
end $$;
