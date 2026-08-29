-- LO QUE FALTA PAGAR, no lo que se debía al principio.
--
-- Con pagos parciales la deuda ya no es «el importe de la factura»: es el
-- importe menos lo abonado. La lista muestra las dos cifras y el saldo, que es
-- lo que hay que ir a pagar.
create or replace view public.v_cuentas_por_pagar as
select e.id,
       'egreso'::text as tipo,
       e.project_id,
       p.name as proyecto,
       coalesce(c.name, e.supplier) as proveedor,
       c.tax_id as proveedor_nit,
       e.numero as numero,
       e.numero_factura,
       e.description as detalle,
       e.incurred_on as fecha,
       e.vencimiento,
       round(e.amount_bob - private.pagado_de_egreso(e.id), 2) as monto,
       greatest(0, current_date - e.vencimiento) as dias_vencido,
       e.amount_bob as importe,
       private.pagado_de_egreso(e.id) as pagado
  from public.expenses e
  join public.projects p on p.id = e.project_id
  left join public.contacts c on c.id = e.contact_id
 where e.deleted_at is null and e.forma_pago = 'credito'
   and round(e.amount_bob - private.pagado_de_egreso(e.id), 2) > 0
   and private.ve_contabilidad()
union all
select a.id,
       'activo'::text,
       a.project_id,
       p.name,
       pv.name,
       pv.tax_id,
       'ACT-' || a.codigo,
       a.numero_factura,
       a.nombre,
       a.fecha_compra,
       a.vencimiento,
       round(a.costo - private.pagado_de_activo(a.id), 2),
       greatest(0, current_date - a.vencimiento),
       a.costo,
       private.pagado_de_activo(a.id)
  from public.fixed_assets a
  join public.projects p on p.id = a.project_id
  left join public.contacts pv on pv.id = a.proveedor_contact_id
 where a.forma_pago = 'credito' and a.expense_id is null
   and round(a.costo - private.pagado_de_activo(a.id), 2) > 0
   and private.ve_contabilidad();

alter view public.v_cuentas_por_pagar set (security_invoker = true);

-- El registro de comprobantes nombra bien el pago.
create or replace view public.v_comprobantes as
select d.project_id,
       p.name as proyecto,
       d.comprobante as numero,
       d.origen,
       d.origen_id,
       case d.origen
         when 'comprobante'     then 'Comprobante manual'
         when 'egreso'          then 'Comprobante de egreso'
         when 'venta'           then 'Venta'
         when 'pago'            then 'Recibo de cobro'
         when 'terreno'         then 'Compra de terreno'
         when 'activo'          then 'Activo fijo'
         when 'fondo'           then 'Fondo a rendir'
         when 'pago_proveedor'  then 'Pago a proveedor'
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

-- ---------------------------------------------------------------------------
-- EL FLUJO DE CAJA, de caja de verdad.
--
-- Contaba el egreso el día que se incurría. Mientras todo se pagaba al
-- contado daba lo mismo; con crédito, fondos y sueldos devengados pasó a
-- mentir: mostraba plata saliendo un mes en el que no salió un peso.
--
-- La definición honesta es la única que no hay que ir corrigiendo: lo que
-- entró y salió POR LAS CUENTAS DE CAJA Y BANCO, según el propio libro. Así
-- cualquier documento nuevo queda bien contado sin tocar esta vista.
-- ---------------------------------------------------------------------------
create or replace view public.v_monthly_cashflow as
select d.project_id,
       date_trunc('month', d.fecha::timestamptz)::date as mes,
       sum(d.debe)  as ingresos_bob,
       sum(d.haber) as egresos_bob,
       sum(d.debe) - sum(d.haber) as resultado_bob
  from private.libro_base d
 where d.cuenta = '1111'
    or d.cuenta in (select account_code from public.treasury_accounts)
 group by d.project_id, date_trunc('month', d.fecha::timestamptz)::date;

comment on view public.v_monthly_cashflow is
  'Entradas y salidas por las cuentas de caja y banco, mes a mes. Sale del '
  'libro, así que un gasto a crédito recién aparece el día que se paga.';

-- ---------------------------------------------------------------------------
-- Los guardianes se ajustan al saldo, y aparece el de sueldos.
-- ---------------------------------------------------------------------------
do $$
declare v_def text; v_ancla text; v_nuevo text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'verificar_integridad';

  -- 1. Proveedores: ahora se compara contra el SALDO, no contra el importe.
  v_ancla := $a$  select coalesce((select sum(e.amount_bob) from public.expenses e
                    where e.deleted_at is null and e.forma_pago = 'credito'
                      and e.pagado_el is null), 0)
       + coalesce((select sum(a.costo) from public.fixed_assets a
                    where a.forma_pago = 'credito' and a.pagado_el is null
                      and a.expense_id is null), 0)
    into v_h;$a$;
  if position(v_ancla in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA' using detail = 'el guardián de proveedores no está como se esperaba.';
  end if;
  v_def := replace(v_def, v_ancla,
    $n$  select coalesce((select sum(round(e.amount_bob - private.pagado_de_egreso(e.id), 2))
                     from public.expenses e
                    where e.deleted_at is null and e.forma_pago = 'credito'), 0)
       + coalesce((select sum(round(a.costo - private.pagado_de_activo(a.id), 2))
                     from public.fixed_assets a
                    where a.forma_pago = 'credito' and a.expense_id is null), 0)
    into v_h;$n$);

  -- 2. Y se suma el de sueldos devengados.
  v_ancla := $a$  return query select 'el_activo_de_egreso_capitaliza'::text, (v_n = 0),
    format('%s activo(s) cuyo egreso no capitalizó en su cuenta', v_n);
end;$a$;
  if position(v_ancla in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA' using detail = 'verificar_integridad no termina como se esperaba.';
  end if;
  v_nuevo := $n$  return query select 'el_activo_de_egreso_capitaliza'::text, (v_n = 0),
    format('%s activo(s) cuyo egreso no capitalizó en su cuenta', v_n);

  -- Lo que se le debe al personal es exactamente la planilla devengada y no
  -- pagada. Si no cuadra, o hay un sueldo asentado a mano o falta un pago.
  select coalesce(sum(haber), 0) - coalesce(sum(debe), 0) into v_d
    from public.v_libro_diario where cuenta = '2.01.07.010';
  select coalesce(sum(round(e.amount_bob - private.pagado_de_egreso(e.id), 2)), 0) into v_h
    from public.expenses e
   where e.deleted_at is null and e.forma_pago = 'planilla';
  return query select 'sueldos_por_pagar_cuadra'::text, (round(v_d,2) = round(v_h,2)),
    format('libro %s / sin pagar %s', round(v_d,2), round(v_h,2));

  -- Nadie pagó más de lo que debía.
  select count(*) into v_n from (
    select e.id from public.expenses e
     where e.deleted_at is null and e.forma_pago in ('credito','planilla')
       and private.pagado_de_egreso(e.id) > e.amount_bob + 0.005
    union all
    select a.id from public.fixed_assets a
     where a.forma_pago = 'credito'
       and private.pagado_de_activo(a.id) > a.costo + 0.005) s;
  return query select 'ningun_pago_mayor_a_la_deuda'::text, (v_n = 0),
    format('%s documento(s) con pagos por encima de la deuda', v_n);
end;$n$;

  execute replace(v_def, v_ancla, v_nuevo);
end $$;
