-- DOS COSAS QUE LA CONTADORA MARCÓ.
--
-- 1) «No hay una conexión entre los egresos y los comprobantes registrados».
--    Tenía razón: el egreso entraba al diario con un número inventado a
--    partir del uuid («EGR-a3f19b2c04»), que no es correlativo, no se puede
--    citar y no figura en el registro de comprobantes. El registro solo
--    mostraba los asientos manuales, así que la mitad de los movimientos del
--    libro no tenía comprobante que los respaldara.
--
--    Ahora cada egreso lleva su CORRELATIVO por urbanización (C/E-0001), es
--    el mismo número que aparece en el diario, en el mayor y en el papel que
--    se firma, y hay UN registro de comprobantes que los junta a todos —los
--    manuales y los que arma el sistema— con el enlace a su documento.
--
-- 2) «El libro mayor no tiene fecha de registro, modificación, creación,
--    usuario, tipo de cambio, entre otros aspectos importantes».
--    También tenía razón: el diario mostraba fecha de la operación, cuenta e
--    importe y nada más. Un libro tiene que decir CUÁNDO se asentó (no solo a
--    qué fecha), cuándo se tocó por última vez, QUIÉN lo asentó y a qué tipo
--    de cambio, con el importe en su moneda de origen.

-- ---------------------------------------------------------------------------
-- 1. El correlativo del egreso
-- ---------------------------------------------------------------------------
alter table public.expenses add column if not exists numero text;

comment on column public.expenses.numero is
  'Correlativo del comprobante de egreso por urbanización (C/E-0001). Es el '
  'número que se cita en el diario, en el mayor y en el papel firmado.';

create unique index if not exists expenses_numero_uidx
  on public.expenses (project_id, numero) where numero is not null;

create or replace function private.next_expense_number(p_project_id uuid)
returns text
language sql
stable
set search_path to 'public', 'private'
as $$
  select 'C/E-' || lpad((coalesce(max(substring(numero from '[0-9]+$')::int), 0) + 1)::text, 4, '0')
    from public.expenses
   where project_id = p_project_id;
$$;

create or replace function private.tg_expense_numero()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
begin
  if new.numero is null then
    new.numero := private.next_expense_number(new.project_id);
  end if;
  return new;
end;
$$;

drop trigger if exists expenses_numero on public.expenses;
create trigger expenses_numero before insert on public.expenses
  for each row execute function private.tg_expense_numero();

-- Los que ya estaban cargados reciben su número por orden de fecha, que es el
-- orden en que se firmaron.
with ordenados as (
  select id,
         row_number() over (partition by project_id order by incurred_on, created_at, id) as n
    from public.expenses
   where numero is null
)
update public.expenses e
   set numero = 'C/E-' || lpad(o.n::text, 4, '0')
  from ordenados o
 where o.id = e.id;

-- ---------------------------------------------------------------------------
-- 2. El diario, con su bitácora y el número de comprobante de verdad
-- ---------------------------------------------------------------------------
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
-- Egreso: de dónde salió la plata
select e.project_id, e.incurred_on,
       coalesce(e.numero, 'EGR-' || left(replace(e.id::text, '-', ''), 10)),
       coalesce(ec.nombre || ' — ', '') || e.description || coalesce(' — ' || coalesce(c.name, e.supplier), ''),
       coalesce(t.account_code, '1111'::text),
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
-- Comprobantes manuales
select je.project_id, je.entry_date, je.number,
       je.glosa || coalesce(' — ' || jl.glosa, ''),
       jl.account_code, jl.debe, jl.haber,
       je.id, 'comprobante'::text,
       rv.buyer_ci_normalized, rv.buyer_full_name,
       je.centro_costo_id, cc.nombre,
       je.titular, je.titular_nombre,
       je.created_at, je.updated_at,
       coalesce(je.posted_by, je.created_by),
       pr.full_name,
       'BOB'::text, 1::numeric, jl.debe + jl.haber
  from public.journal_entries je
  join public.journal_lines jl on jl.entry_id = je.id
  left join public.reservations rv on rv.id = je.reservation_id
  left join public.centros_costo cc on cc.id = je.centro_costo_id
  left join public.profiles pr on pr.id = coalesce(je.posted_by, je.created_by)
 where je.status = 'registrado'::voucher_status;

comment on view public.v_libro_diario is
  'El libro diario. Además del asiento lleva su bitácora: cuándo se registró, '
  'cuándo se modificó por última vez, quién lo hizo, en qué moneda y a qué '
  'tipo de cambio, con el importe en su moneda de origen.';
