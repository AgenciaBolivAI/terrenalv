-- El egreso con todo lo que necesita su comprobante, en una sola consulta.
-- Un comprobante de egreso tiene que poder decir, sin que nadie busque en
-- otro lado: qué se pagó, a quién, de qué caja salió, a qué cuenta contable
-- fue, a qué centro carga y a nombre de quién está.
create or replace view public.v_egresos as
select e.id,
       e.project_id,
       p.name                     as proyecto,
       e.incurred_on              as fecha,
       'EGR-' || left(replace(e.id::text, '-', ''), 10) as numero,
       e.description              as detalle,
       e.note                     as nota,
       e.amount,
       e.currency,
       e.amount_bob,
       e.exchange_rate_used,
       e.category::text           as categoria,
       ec.id                      as concepto_id,
       ec.codigo                  as concepto_codigo,
       ec.nombre                  as concepto,
       coalesce(ec.account_code,
         case e.category
           when 'obra' then '5111' when 'comisiones' then '5211'
           when 'sueldos' then '5221' when 'publicidad' then '5311'
           when 'administracion' then '5411' when 'impuestos' then '5511'
           when 'financiero' then '5611' else '5911' end)  as cuenta_codigo,
       ca.name                    as cuenta_nombre,
       coalesce(c.name, e.supplier) as proveedor,
       c.tax_id                   as proveedor_nit,
       c.phone                    as proveedor_telefono,
       t.id                       as cuenta_tesoreria_id,
       t.name                     as pagado_de,
       t.ambito                   as cuenta_ambito,
       t.account_code             as cuenta_tesoreria_codigo,
       cc.id                      as centro_costo_id,
       cc.codigo                  as centro_costo_codigo,
       cc.nombre                  as centro_costo,
       e.titular,
       e.titular_nombre,
       e.reservation_id,
       r.tracking_code,
       r.buyer_full_name          as cliente,
       e.receipt_storage_path,
       e.created_at,
       pr.full_name               as cargado_por
  from public.expenses e
  join public.projects p on p.id = e.project_id
  left join public.expense_concepts ec on ec.id = e.concept_id
  left join public.chart_of_accounts ca on ca.code = coalesce(ec.account_code,
         case e.category
           when 'obra' then '5111' when 'comisiones' then '5211'
           when 'sueldos' then '5221' when 'publicidad' then '5311'
           when 'administracion' then '5411' when 'impuestos' then '5511'
           when 'financiero' then '5611' else '5911' end)
  left join public.contacts c on c.id = e.contact_id
  left join public.treasury_accounts t on t.id = e.treasury_account_id
  left join public.centros_costo cc on cc.id = e.centro_costo_id
  left join public.reservations r on r.id = e.reservation_id
  left join public.profiles pr on pr.id = e.created_by
 where e.deleted_at is null;

alter view public.v_egresos set (security_invoker = true);
