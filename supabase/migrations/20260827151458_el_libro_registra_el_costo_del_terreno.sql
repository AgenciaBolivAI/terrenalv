-- Tres asientos que faltaban, y sin ellos el resultado era mentira:
--   · La compra del terreno madre: inventario (1151) contra la caja.
--   · Las obras que capitalizan: van a inventario, no a gasto del mes.
--   · El costo de lo vendido: al vender, sale del inventario y se vuelve
--     costo (5121). Recién ahí Ventas − Costo da margen bruto.

create or replace view public.v_libro_diario as
 with base_venta as (
   select r.*,
     case
       when r.client_meta ? 'migrado_de' then coalesce(((r.client_meta -> 'reportado') ->> 'deuda')::numeric, r.price_agreed)
       when r.client_meta ? 'traspaso' then coalesce(((r.client_meta -> 'traspaso') ->> 'baseline_original')::numeric, r.price_agreed)
       else r.price_agreed
     end as monto_venta,
     r.status = 'confirmada'::reservation_status or r.client_meta ? 'traspasada_a' as cadena_viva,
     r.status = any (array['pendiente_pago'::reservation_status,'en_verificacion'::reservation_status,'rechazo_reintento'::reservation_status]) as reserva_viva,
     (r.status = any (array['expirada'::reservation_status,'cancelada'::reservation_status])) and not r.client_meta ? 'traspasada_a' as reserva_caida
   from public.reservations r
 ), costo_venta as (
   -- Lo que costó el lote que se vendió, medido a la fecha de la venta.
   select r.id, r.project_id, r.buyer_ci_normalized, r.buyer_full_name,
          r.tracking_code, r.titular, r.titular_nombre,
          (r.confirmed_at at time zone 'America/La_Paz')::date as fecha,
          round(coalesce(l.area_m2, 0)
                * private.costo_m2(r.project_id,
                    (r.confirmed_at at time zone 'America/La_Paz')::date), 2) as costo
     from public.reservations r
     join public.lots l on l.id = r.lot_id
    where r.status = 'confirmada' and r.confirmed_at is not null
 )
 select r.project_id, (r.confirmed_at at time zone 'America/La_Paz')::date as fecha,
    'VTA-' || r.tracking_code as comprobante,
    'Venta de lote — ' || r.buyer_full_name as glosa,
    '1131'::text as cuenta, r.monto_venta as debe, 0::numeric as haber,
    r.id as origen_id, 'venta'::text as origen,
    r.buyer_ci_normalized as cliente_ci, r.buyer_full_name as cliente,
    null::uuid as centro_costo_id, null::text as centro_costo,
    r.titular, r.titular_nombre
   from base_venta r
  where r.confirmed_at is not null and r.status = 'confirmada'
union all
 select r.project_id, (r.confirmed_at at time zone 'America/La_Paz')::date,
    'VTA-' || r.tracking_code, 'Venta de lote — ' || r.buyer_full_name,
    '4111'::text, 0::numeric, r.monto_venta, r.id, 'venta'::text,
    r.buyer_ci_normalized, r.buyer_full_name, null::uuid, null::text,
    r.titular, r.titular_nombre
   from base_venta r
  where r.confirmed_at is not null and r.status = 'confirmada'
union all
 -- Costo de lo vendido: sale del inventario…
 select cv.project_id, cv.fecha, 'VTA-' || cv.tracking_code,
    'Costo del lote vendido — ' || cv.buyer_full_name,
    '5121'::text, cv.costo, 0::numeric, cv.id, 'venta'::text,
    cv.buyer_ci_normalized, cv.buyer_full_name, null::uuid, null::text,
    cv.titular, cv.titular_nombre
   from costo_venta cv where cv.costo > 0
union all
 -- …y baja el inventario.
 select cv.project_id, cv.fecha, 'VTA-' || cv.tracking_code,
    'Costo del lote vendido — ' || cv.buyer_full_name,
    '1151'::text, 0::numeric, cv.costo, cv.id, 'venta'::text,
    cv.buyer_ci_normalized, cv.buyer_full_name, null::uuid, null::text,
    cv.titular, cv.titular_nombre
   from costo_venta cv where cv.costo > 0
union all
 select p.project_id, (p.verified_at at time zone 'America/La_Paz')::date,
    'PAGO-' || p.reference_code,
    (case p.purpose when 'cuota' then 'Cobro de cuota' when 'abono' then 'Abono al lote'
       when 'comision' then 'Comisión del mercado de traspasos' else 'Cobro de seña / reserva' end
     || ' por ' || private.forma_de_pago(p.provider) || ' — ' || r.buyer_full_name
     || ' (' || r.tracking_code || ')'),
    coalesce(t.account_code, '1111'), p.amount_bob, 0::numeric, p.id, 'pago'::text,
    r.buyer_ci_normalized, r.buyer_full_name, null::uuid, null::text,
    r.titular, r.titular_nombre
   from public.payments p
   join public.reservations r on r.id = p.reservation_id
   left join public.treasury_accounts t on t.id = p.treasury_account_id
  where p.status = 'aprobado' and p.verified_at is not null
union all
 select p.project_id, (p.verified_at at time zone 'America/La_Paz')::date,
    'PAGO-' || p.reference_code,
    (case p.purpose when 'cuota' then 'Cobro de cuota' when 'abono' then 'Abono al lote'
       when 'comision' then 'Comisión del mercado de traspasos' else 'Cobro de seña / reserva' end
     || ' por ' || private.forma_de_pago(p.provider) || ' — ' || r.buyer_full_name
     || ' (' || r.tracking_code || ')'),
    case when p.purpose = 'comision' then '4211'
         when p.purpose = 'reserva' and b.reserva_caida then '4411'
         when b.cadena_viva then '1131' else '2131' end,
    0::numeric, p.amount_bob - coalesce(p.interest_bob, 0), p.id, 'pago'::text,
    r.buyer_ci_normalized, r.buyer_full_name, null::uuid, null::text,
    r.titular, r.titular_nombre
   from public.payments p
   join base_venta b on b.id = p.reservation_id
   join public.reservations r on r.id = p.reservation_id
  where p.status = 'aprobado' and p.verified_at is not null
    and (p.amount_bob - coalesce(p.interest_bob, 0)) <> 0
union all
 select p.project_id, (p.verified_at at time zone 'America/La_Paz')::date,
    'PAGO-' || p.reference_code,
    'Interés de financiamiento — ' || r.buyer_full_name || ' (' || r.tracking_code || ')',
    '4311'::text, 0::numeric, p.interest_bob, p.id, 'pago'::text,
    r.buyer_ci_normalized, r.buyer_full_name, null::uuid, null::text,
    r.titular, r.titular_nombre
   from public.payments p
   join public.reservations r on r.id = p.reservation_id
  where p.status = 'aprobado' and p.verified_at is not null
    and coalesce(p.interest_bob, 0) > 0
union all
 -- La compra del terreno madre: mercadería, no gasto.
 select lp.project_id, lp.fecha_compra,
    'TERR-' || lp.codigo,
    'Compra de terreno — ' || lp.nombre
      || coalesce(' — ' || coalesce(c.name, lp.vendedor_nombre), ''),
    '1151'::text, lp.costo_compra, 0::numeric, lp.id, 'terreno'::text,
    null::text, null::text, null::uuid, null::text,
    lp.titular, lp.titular_nombre
   from public.land_parcels lp
   left join public.contacts c on c.id = lp.vendedor_contact_id
  where lp.costo_compra > 0
union all
 select lp.project_id, lp.fecha_compra,
    'TERR-' || lp.codigo,
    'Compra de terreno — ' || lp.nombre
      || coalesce(' — ' || coalesce(c.name, lp.vendedor_nombre), ''),
    coalesce(t.account_code, '1111'), 0::numeric, lp.costo_compra, lp.id, 'terreno'::text,
    null::text, null::text, null::uuid, null::text,
    lp.titular, lp.titular_nombre
   from public.land_parcels lp
   left join public.contacts c on c.id = lp.vendedor_contact_id
   left join public.treasury_accounts t on t.id = lp.treasury_account_id
  where lp.costo_compra > 0
union all
 select e.project_id, e.incurred_on,
    'EGR-' || left(replace(e.id::text, '-', ''), 10),
    coalesce(ec.nombre || ' — ', '') || e.description
      || coalesce(' — ' || coalesce(c.name, e.supplier), ''),
    -- Si el centro capitaliza, esto no es gasto: engorda el inventario.
    case when cc.capitaliza then '1151'
         else coalesce(ec.account_code,
           case e.category
             when 'obra' then '5111' when 'comisiones' then '5211'
             when 'sueldos' then '5221' when 'publicidad' then '5311'
             when 'administracion' then '5411' when 'impuestos' then '5511'
             when 'financiero' then '5611' else '5911' end) end,
    e.amount_bob, 0::numeric, e.id, 'egreso'::text,
    rv.buyer_ci_normalized, rv.buyer_full_name,
    e.centro_costo_id, cc.nombre, e.titular, e.titular_nombre
   from public.expenses e
   left join public.contacts c on c.id = e.contact_id
   left join public.reservations rv on rv.id = e.reservation_id
   left join public.centros_costo cc on cc.id = e.centro_costo_id
   left join public.expense_concepts ec on ec.id = e.concept_id
  where e.deleted_at is null
union all
 select e.project_id, e.incurred_on,
    'EGR-' || left(replace(e.id::text, '-', ''), 10),
    coalesce(ec.nombre || ' — ', '') || e.description
      || coalesce(' — ' || coalesce(c.name, e.supplier), ''),
    coalesce(t.account_code, '1111'),
    0::numeric, e.amount_bob, e.id, 'egreso'::text,
    rv.buyer_ci_normalized, rv.buyer_full_name,
    e.centro_costo_id, cc.nombre, e.titular, e.titular_nombre
   from public.expenses e
   left join public.treasury_accounts t on t.id = e.treasury_account_id
   left join public.contacts c on c.id = e.contact_id
   left join public.reservations rv on rv.id = e.reservation_id
   left join public.centros_costo cc on cc.id = e.centro_costo_id
   left join public.expense_concepts ec on ec.id = e.concept_id
  where e.deleted_at is null
union all
 select je.project_id, je.entry_date, je.number,
    je.glosa || coalesce(' — ' || jl.glosa, ''),
    jl.account_code, jl.debe, jl.haber, je.id, 'comprobante'::text,
    rv.buyer_ci_normalized, rv.buyer_full_name,
    je.centro_costo_id, cc.nombre, je.titular, je.titular_nombre
   from public.journal_entries je
   join public.journal_lines jl on jl.entry_id = je.id
   left join public.reservations rv on rv.id = je.reservation_id
   left join public.centros_costo cc on cc.id = je.centro_costo_id
  where je.status = 'registrado';

alter view public.v_libro_diario set (security_invoker = true);
