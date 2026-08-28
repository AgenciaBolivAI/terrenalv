-- El comprobante de egreso que se imprime y se firma lee su número de
-- `v_egresos.numero`, que hasta acá era el uuid recortado. Ahora es el
-- correlativo del libro (C/E-0001) — el mismo que aparece en el diario, en el
-- mayor y en el registro de comprobantes. Si el papel dijera otra cosa que el
-- libro, el papel no sirve de respaldo.
create or replace view public.v_egresos as
select e.id,
       e.project_id,
       p.name as proyecto,
       e.incurred_on as fecha,
       coalesce(e.numero, 'EGR-' || left(replace(e.id::text, '-', ''), 10)) as numero,
       e.description as detalle,
       e.note as nota,
       e.amount,
       e.currency,
       e.amount_bob,
       e.exchange_rate_used,
       e.category::text as categoria,
       ec.id as concepto_id,
       ec.codigo as concepto_codigo,
       ec.nombre as concepto,
       coalesce(ec.account_code,
         case e.category
           when 'obra'::expense_category then '5111'::text
           when 'comisiones'::expense_category then '5211'::text
           when 'sueldos'::expense_category then '5221'::text
           when 'publicidad'::expense_category then '5311'::text
           when 'administracion'::expense_category then '5411'::text
           when 'impuestos'::expense_category then '5511'::text
           when 'financiero'::expense_category then '5611'::text
           else '5911'::text
         end) as cuenta_codigo,
       ca.name as cuenta_nombre,
       coalesce(c.name, e.supplier) as proveedor,
       c.tax_id as proveedor_nit,
       c.phone as proveedor_telefono,
       t.id as cuenta_tesoreria_id,
       t.name as pagado_de,
       t.ambito as cuenta_ambito,
       t.account_code as cuenta_tesoreria_codigo,
       cc.id as centro_costo_id,
       cc.codigo as centro_costo_codigo,
       cc.nombre as centro_costo,
       e.titular,
       e.titular_nombre,
       e.reservation_id,
       r.tracking_code,
       r.buyer_full_name as cliente,
       e.receipt_storage_path,
       e.created_at,
       pr.full_name as cargado_por,
       -- El código de la cuenta tal como figura en el plan (5.01.04.070), que
       -- es el que la contadora busca en el listado.
       coalesce(ca.codigo_plan, ca.code) as cuenta_codigo_plan,
       e.updated_at
  from public.expenses e
  join public.projects p on p.id = e.project_id
  left join public.expense_concepts ec on ec.id = e.concept_id
  left join public.chart_of_accounts ca on ca.code = coalesce(ec.account_code,
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
  left join public.contacts c on c.id = e.contact_id
  left join public.treasury_accounts t on t.id = e.treasury_account_id
  left join public.centros_costo cc on cc.id = e.centro_costo_id
  left join public.reservations r on r.id = e.reservation_id
  left join public.profiles pr on pr.id = e.created_by
 where e.deleted_at is null;
