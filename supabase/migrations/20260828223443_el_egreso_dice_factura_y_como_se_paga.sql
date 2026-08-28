-- EL EGRESO DICE SU FACTURA Y CÓMO SE PAGÓ.
--
-- Hasta hoy un egreso siempre salía de la caja: el libro acreditaba la cuenta
-- de tesorería y listo. No existía comprar a crédito —la factura del
-- proveedor que se paga a fin de mes— ni gastar de un fondo entregado a
-- alguien para que rinda. Y la factura, que es el papel que respalda todo, no
-- se guardaba en ningún lado del gerencial.
--
-- Acá van las columnas y sus reglas. El libro todavía no las mira: eso es la
-- migración del diario. Mientras tanto `forma_pago = 'contado'` en todas las
-- filas deja el comportamiento exactamente como estaba.

alter table public.expenses
  add column if not exists numero_factura text,
  add column if not exists forma_pago text not null default 'contado',
  add column if not exists vencimiento date,
  add column if not exists pagado_el date,
  add column if not exists pagado_de uuid references public.treasury_accounts(id),
  add column if not exists fondo_empleado_id uuid references public.hr_empleados(id);

comment on column public.expenses.forma_pago is
  'contado = salió de una caja o banco · credito = queda debiéndose al '
  'proveedor (2.01.04.010) hasta que se pague · fondos_por_rendir = lo gastó '
  'una persona con plata que se le entregó por adelantado (1.02.04.030).';
comment on column public.expenses.numero_factura is
  'El número de la factura o recibo del proveedor. Es lo que la contadora '
  'cita para encontrar el papel.';

alter table public.expenses drop constraint if exists expenses_forma_pago_check;
alter table public.expenses add constraint expenses_forma_pago_check
  check (forma_pago in ('contado','credito','fondos_por_rendir'));

-- Solo el crédito conoce vencimiento y pago al proveedor.
alter table public.expenses drop constraint if exists expenses_credito_check;
alter table public.expenses add constraint expenses_credito_check
  check (forma_pago = 'credito'
         or (vencimiento is null and pagado_el is null and pagado_de is null));

alter table public.expenses drop constraint if exists expenses_pago_completo_check;
alter table public.expenses add constraint expenses_pago_completo_check
  check (pagado_el is null or pagado_de is not null);

alter table public.expenses drop constraint if exists expenses_pago_fecha_check;
alter table public.expenses add constraint expenses_pago_fecha_check
  check (pagado_el is null or pagado_el >= incurred_on);

-- El fondo por rendir lleva persona; ninguna otra forma la lleva.
alter table public.expenses drop constraint if exists expenses_fondo_check;
alter table public.expenses add constraint expenses_fondo_check
  check ((forma_pago = 'fondos_por_rendir') = (fondo_empleado_id is not null));

-- CLAVE para que los saldos de tesorería sigan siendo ciertos: `v_tesoreria_saldos`
-- sale del libro por cuenta, y el libro acredita la cuenta de tesorería del
-- egreso. Si una compra a crédito nombrara una caja, esa caja bajaría sin que
-- saliera un peso.
alter table public.expenses drop constraint if exists expenses_tesoreria_por_forma_check;
alter table public.expenses add constraint expenses_tesoreria_por_forma_check
  check (forma_pago = 'contado' or treasury_account_id is null);

create index if not exists expenses_por_pagar_idx
  on public.expenses (vencimiento)
  where deleted_at is null and forma_pago = 'credito' and pagado_el is null;

-- ---------------------------------------------------------------------------
-- La vista del comprobante de egreso, con lo nuevo AL FINAL. `pagado_de` ya
-- era el NOMBRE de la caja de la que salió: la cuenta con la que después se
-- cancela la deuda se llama `cancelado_de` para no pisarla.
-- ---------------------------------------------------------------------------
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
       coalesce(ca.codigo_plan, ca.code) as cuenta_codigo_plan,
       e.updated_at,
       e.forma_pago,
       e.numero_factura,
       e.vencimiento,
       e.pagado_el,
       tp.name as cancelado_de,
       e.fondo_empleado_id,
       fe.nombre_completo as fondo_de
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
  left join public.treasury_accounts tp on tp.id = e.pagado_de
  left join public.hr_empleados fe on fe.id = e.fondo_empleado_id
  left join public.centros_costo cc on cc.id = e.centro_costo_id
  left join public.reservations r on r.id = e.reservation_id
  left join public.profiles pr on pr.id = e.created_by
 where e.deleted_at is null;

-- Se vuelve a poner la puerta: la definición nueva reemplazó el envoltorio.
create or replace view public.v_egresos as
select * from (
  select * from public.v_egresos
) egresos where private.ve_contabilidad();
