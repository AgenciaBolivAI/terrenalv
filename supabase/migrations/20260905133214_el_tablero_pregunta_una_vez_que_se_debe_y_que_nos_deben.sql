-- El tablero pasa a contestar dos preguntas de plata, no diez cifras sueltas:
-- QUÉ NOS DEBEN y QUÉ DEBEMOS. Para eso hacían falta tres cosas.
--
-- 1) Dos conceptos de egreso que el dueño nombró y no existían. Las cuentas ya
--    estaban en el plan de la contadora, sin usar:
--      · Influencers            → 5.01.06.030 GASTOS EN MARKETING
--      · Servicios tercerizados → 5.01.04.120 SERVICIOS PROFESIONALES
--    («Servicios» ya existía: son los básicos, SB-LUZ/AGUA/GAS/TEL/INT.)
--
-- 2) Un GRUPO en las cuentas por pagar. Todas se acreditan igual en el libro
--    (2.01.04.010 Proveedores por Pagar): el grupo es para LEER, no cambia un
--    solo asiento. Sale del concepto del egreso, así que se mantiene solo.
--
-- 3) Un solo RPC con las dos columnas ya sumadas por la base. Se suma allá y no
--    en el navegador por el tope de 1.000 filas de PostgREST, que ya nos mordió
--    tres veces.
--
-- «Utilidades» no es un gasto: es lo que se les debe a los socios por reparto
-- de resultados. Sale del saldo de 2.01.13.010 DIVIDENDOS POR PAGAR.

-- ---------------------------------------------------------------- 1) conceptos
insert into public.expense_concepts (codigo, nombre, categoria, account_code, ayuda, sort_order, is_active)
select v.codigo, v.nombre, v.categoria::expense_category, v.account_code, v.ayuda,
       (select coalesce(max(ec.sort_order), 0) + 1 from public.expense_concepts ec
         where ec.categoria::text = v.categoria),
       true
from (values
  ('COM-INFL', 'Influencers y creadores', 'publicidad', '5.01.06.030',
   'Pagos a influencers y creadores de contenido por difusión.'),
  ('OP-TERC', 'Servicios tercerizados', 'administracion', '5.01.04.120',
   'Trabajo continuo de una empresa o persona de afuera: seguridad, limpieza, contabilidad externa, sistemas.')
) as v(codigo, nombre, categoria, account_code, ayuda)
where not exists (
  select 1 from public.expense_concepts ec where lower(btrim(ec.codigo)) = lower(btrim(v.codigo)));

-- ------------------------------------------------------- 2) el grupo a pagar
create or replace view public.v_cuentas_por_pagar as
 select e.id,
    'egreso'::text as tipo,
    e.project_id,
    p.name as proyecto,
    coalesce(c.name, e.supplier) as proveedor,
    c.tax_id as proveedor_nit,
    e.numero,
    e.numero_factura,
    e.description as detalle,
    e.incurred_on as fecha,
    e.vencimiento,
    round(e.amount_bob - private.pagado_de_egreso(e.id), 2) as monto,
    greatest(0, current_date - e.vencimiento) as dias_vencido,
    e.amount_bob as importe,
    private.pagado_de_egreso(e.id) as pagado,
    case
      when ec.codigo = 'COM-INFL'                          then 'Influencers'
      when ec.codigo = 'OP-TERC'                           then 'Servicios tercerizados'
      when ec.codigo like 'SB-%'                           then 'Servicios'
      when ec.categoria::text in ('sueldos','comisiones')  then 'Personal y comisiones'
      else 'Proveedores'
    end as grupo
   from expenses e
     join projects p on p.id = e.project_id
     left join contacts c on c.id = e.contact_id
     left join expense_concepts ec on ec.id = e.concept_id
  where e.deleted_at is null and e.forma_pago = 'credito'::text
    and round(e.amount_bob - private.pagado_de_egreso(e.id), 2) > 0::numeric
    and private.ve_contabilidad()
union all
 select a.id,
    'activo'::text as tipo,
    a.project_id,
    p.name as proyecto,
    pv.name as proveedor,
    pv.tax_id as proveedor_nit,
    'ACT-'::text || a.codigo as numero,
    a.numero_factura,
    a.nombre as detalle,
    a.fecha_compra as fecha,
    a.vencimiento,
    round(a.costo - private.pagado_de_activo(a.id), 2) as monto,
    greatest(0, current_date - a.vencimiento) as dias_vencido,
    a.costo as importe,
    private.pagado_de_activo(a.id) as pagado,
    'Proveedores'::text as grupo
   from fixed_assets a
     join projects p on p.id = a.project_id
     left join contacts pv on pv.id = a.proveedor_contact_id
  where a.forma_pago = 'credito'::text and a.expense_id is null
    and round(a.costo - private.pagado_de_activo(a.id), 2) > 0::numeric
    and private.ve_contabilidad();

-- --------------------------------------------- 3) las dos columnas, de una
-- Todo «al corte»: un saldo no tiene período, tiene fecha. Así el mismo
-- selector de arriba gobierna la pantalla entera sin mentir.
create or replace function public.rep_tablero_cobrar_pagar(
  p_project_id uuid default null,
  p_hasta date default null
)
returns table(columna text, grupo text, monto numeric, documentos integer, filtro text)
language sql
stable
set search_path to 'public', 'private', 'extensions'
as $$
  with corte as (select coalesce(p_hasta, current_date) as h),
  ventas as (
    select round(sum(v.saldo), 2) as monto, count(*)::int as n
      from public.v_ventas v
     where v.compra_iniciada and v.saldo > 0
       and (p_project_id is null or v.project_id = p_project_id)
  ),
  mora as (
    select round(sum(i.amount - coalesce(i.amount_paid, 0)), 2) as monto, count(*)::int as n
      from public.installments i, corte
     where i.status = 'pendiente' and i.due_date < corte.h
       and (p_project_id is null or i.project_id = p_project_id)
  ),
  banco as (
    -- Toda la caja del libro, incluida la que todavía no tiene cuenta asignada.
    select round(sum(b.debe) - sum(b.haber), 2) as monto,
           count(distinct b.cuenta)::int as n
      from private.libro_base b, corte
     where b.fecha <= corte.h
       and (b.cuenta in ('1111', '1111.00')
            or b.cuenta in (select account_code from public.treasury_accounts))
       and (p_project_id is null or b.project_id = p_project_id)
  ),
  pagar as (
    select cp.grupo as g, round(sum(cp.monto), 2) as monto, count(*)::int as n
      from public.v_cuentas_por_pagar cp
     where (p_project_id is null or cp.project_id = p_project_id)
     group by cp.grupo
  ),
  utilidades as (
    select round(sum(b.haber) - sum(b.debe), 2) as monto, count(*)::int as n
      from private.libro_base b, corte
     where b.cuenta = '2.01.13.010' and b.fecha <= corte.h
       and (p_project_id is null or b.project_id = p_project_id)
  )
  select 'cobrar'::text, 'Ventas por cobrar'::text, coalesce(v.monto,0), coalesce(v.n,0), 'saldo'::text from ventas v
  union all
  select 'cobrar', 'Cuotas en mora', coalesce(m.monto,0), coalesce(m.n,0), 'atraso' from mora m
  union all
  select 'cobrar', 'Saldo en banco y caja', coalesce(b.monto,0), coalesce(b.n,0), 'bancos' from banco b
  union all
  select 'pagar', pg.g, pg.monto, pg.n, 'pagar' from pagar pg
  union all
  select 'pagar', 'Utilidades a socios', coalesce(u.monto,0), coalesce(u.n,0), 'libro'
    from utilidades u where coalesce(u.monto,0) <> 0;
$$;

grant execute on function public.rep_tablero_cobrar_pagar(uuid, date) to authenticated;
