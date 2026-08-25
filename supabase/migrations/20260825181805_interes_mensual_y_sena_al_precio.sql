-- Dos cambios que van juntos porque tocan la misma cuenta:
--
-- 1. INTERÉS MENSUAL DE VERDAD. El campo existía pero era decorativo: con
--    interés el sistema generaba N cuotas del monto que le dictaran, sin
--    amortizar nada. Ahora el plan amortiza en serio (sistema francés sobre
--    saldo) y CADA cuota sabe cuánto es capital y cuánto es interés. Al
--    cobrar, el capital baja la deuda del lote y el interés es ingreso
--    financiero — mezclarlos haría que un comprador "termine de pagar" su
--    lote debiendo capital, o que la cuenta por cobrar quede corta.
--
-- 2. LA SEÑA SE APLICA AL PRECIO. La página del comprador ya se lo prometía
--    («tu seña se aplica al precio del lote») pero la contabilidad la dejaba
--    para siempre en anticipos: pagaba Bs 1.000 que no le descontaban de
--    nada. Ahora, cuando la reserva se convierte en venta, la seña baja el
--    saldo Y acredita la cuenta por cobrar. Mientras la reserva no se
--    confirme sigue siendo un anticipo (2131): si se vence, esa plata no era
--    de una venta.

insert into public.chart_of_accounts (code, name, kind)
select '4311', 'Intereses de Financiamiento', 'ingreso'
 where not exists (select 1 from public.chart_of_accounts where code = '4311');

alter table public.installment_plans
  add column if not exists monthly_interest_pct numeric(6,3) not null default 0
    check (monthly_interest_pct >= 0 and monthly_interest_pct <= 20);

alter table public.installments
  add column if not exists interes numeric(12,2) not null default 0 check (interes >= 0);

alter table public.payments
  add column if not exists interest_bob numeric(12,2) not null default 0 check (interest_bob >= 0);

-- ---- El capital que un lote lleva pagado. UNA definición para todos: si cada
--      pantalla hiciera su cuenta, tarde o temprano dirían cifras distintas.
create or replace function private.capital_pagado(p_res uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(
           case
             -- La seña baja el precio solo si la reserva llegó a ser venta
             -- (o si lo fue y se traspasó: su plata viajó con el lote).
             when p.purpose = 'reserva' then
               case when r.status = 'confirmada' or r.client_meta ? 'traspasada_a'
                    then p.amount_bob else 0 end
             -- De una cuota, solo el capital baja la deuda: el interés es
             -- precio del tiempo, no precio del terreno.
             when p.purpose in ('cuota','abono') then p.amount_bob - coalesce(p.interest_bob, 0)
             else 0
           end), 0)
    from public.payments p
    join public.reservations r on r.id = p.reservation_id
   where p.reservation_id = p_res and p.status = 'aprobado';
$$;

grant execute on function private.capital_pagado(uuid) to authenticated, service_role;

-- ---- La deuda base del lote (precio, o lo reportado si vino migrado).
create or replace function private.base_del_lote(p_res uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((r.client_meta->'reportado'->>'deuda')::numeric, r.price_agreed)
    from public.reservations r where r.id = p_res;
$$;

grant execute on function private.base_del_lote(uuid) to authenticated, service_role;

-- ---- Ventas: el saldo usa la definición común.
create or replace view public.v_ventas
with (security_invoker = true) as
select r.project_id,
       r.id as reservation_id,
       r.tracking_code,
       r.buyer_full_name,
       r.buyer_ci,
       r.buyer_phone,
       r.buyer_email,
       (r.confirmed_at at time zone 'America/La_Paz')::date as fecha_venta,
       r.price_agreed,
       r.currency,
       m.code as manzana,
       l.number as lote,
       p.name as proyecto,
       (r.client_meta ? 'migrado_de') as migrada,
       coalesce((r.client_meta->'reportado'->>'deuda')::numeric, null) as deuda_migrada,
       private.capital_pagado(r.id) as cobrado_aqui,
       coalesce(pg.cuotas, 0) as pagos_cuota,
       coalesce(pg.abonos, 0) as pagos_abono,
       greatest(0, coalesce((r.client_meta->'reportado'->>'deuda')::numeric, r.price_agreed)
                   - private.capital_pagado(r.id)) as saldo,
       exists (select 1 from public.installment_plans ip
                where ip.reservation_id = r.id and ip.status = 'activo') as con_plan,
       pg.ultimo_pago,
       ((r.client_meta ? 'migrado_de')
        or (r.client_meta ? 'traspaso')
        or coalesce((r.client_meta->'reportado'->>'abonado')::numeric, 0) > 0
        or private.capital_pagado(r.id) > 0) as compra_iniciada,
       coalesce((r.client_meta->'reportado'->>'abonado')::numeric, 0) as abonado_migrado,
       coalesce((r.client_meta->'reportado'->>'abonado')::numeric, 0)
         + private.capital_pagado(r.id) as pagado_total,
       r.source,
       private.origen_de_venta(r.source, r.client_meta, r.created_at, r.confirmed_at) as origen,
       private.etiqueta_origen(
         private.origen_de_venta(r.source, r.client_meta, r.created_at, r.confirmed_at)
       ) as origen_label,
       (r.client_meta ? 'origen') as origen_declarado,
       coalesce(sn.total, 0) as sena_pagada,
       sn.fecha as sena_fecha,
       coalesce(sn.forma, '') as sena_forma,
       (r.client_meta ? 'traspaso') as traspaso,
       r.client_meta->'traspaso'->>'de_tracking' as traspaso_de_tracking,
       r.client_meta->'traspaso'->>'de_comprador' as traspaso_de_comprador,
       (r.client_meta->'traspaso'->>'pagado_arrastrado')::numeric as traspaso_pagado,
       r.client_meta->'traspasada_a'->>'tracking' as traspasada_a_tracking,
       (ml.id is not null) as en_mercado,
       ml.id as mercado_listing_id,
       ml.asking_price_bob as mercado_pide,
       ml.fee_pct as mercado_fee_pct,
       coalesce(pg.intereses, 0) as intereses_pagados
  from public.reservations r
  join public.projects p on p.id = r.project_id
  left join public.lots l on l.id = r.lot_id
  left join public.manzanas m on m.id = l.manzana_id
  left join lateral (
    select count(*) filter (where x.purpose = 'cuota') as cuotas,
           count(*) filter (where x.purpose = 'abono') as abonos,
           sum(x.interest_bob) as intereses,
           max((x.verified_at at time zone 'America/La_Paz')::date) as ultimo_pago
      from public.payments x
     where x.reservation_id = r.id and x.status = 'aprobado'
       and x.purpose in ('cuota','abono')
  ) pg on true
  left join lateral (
    select sum(x.amount_bob) as total,
           max((x.verified_at at time zone 'America/La_Paz')::date) as fecha,
           max(private.forma_de_pago(x.provider)) as forma
      from public.payments x
     where x.reservation_id = r.id and x.status = 'aprobado' and x.purpose = 'reserva'
  ) sn on true
  left join public.market_listings ml
    on ml.reservation_id = r.id and ml.status in ('activa','pausada')
 where r.status = 'confirmada';

grant select on public.v_ventas to authenticated;

-- ---- El libro: capital a 1131, interés a 4311, y la seña de una venta viva
--      deja de ser anticipo — se aplicó al precio.
create or replace view public.v_libro_diario
with (security_invoker = true) as
with base_venta as (
  select r.*,
         case
           when r.client_meta ? 'migrado_de'
             then coalesce((r.client_meta->'reportado'->>'deuda')::numeric, r.price_agreed)
           when r.client_meta ? 'traspaso'
             then coalesce((r.client_meta->'traspaso'->>'baseline_original')::numeric, r.price_agreed)
           else r.price_agreed
         end as monto_venta,
         (r.status = 'confirmada' or r.client_meta ? 'traspasada_a') as cadena_viva
    from public.reservations r
)
select r.project_id,
       (r.confirmed_at at time zone 'America/La_Paz')::date as fecha,
       'VTA-' || r.tracking_code as comprobante,
       'Venta de lote — ' || r.buyer_full_name as glosa,
       '1131'::text as cuenta,
       r.monto_venta as debe, 0::numeric as haber,
       r.id as origen_id, 'venta'::text as origen
  from base_venta r
 where r.confirmed_at is not null and r.status = 'confirmada'
union all
select r.project_id,
       (r.confirmed_at at time zone 'America/La_Paz')::date,
       'VTA-' || r.tracking_code,
       'Venta de lote — ' || r.buyer_full_name,
       '4111'::text, 0::numeric, r.monto_venta,
       r.id, 'venta'
  from base_venta r
 where r.confirmed_at is not null and r.status = 'confirmada'
union all
-- La plata que entró (débito a la cuenta donde cayó).
select p.project_id,
       (p.verified_at at time zone 'America/La_Paz')::date,
       'PAGO-' || p.reference_code,
       case p.purpose
         when 'cuota'    then 'Cobro de cuota'
         when 'abono'    then 'Abono al lote'
         when 'comision' then 'Comisión del mercado de traspasos'
         else 'Cobro de seña / reserva'
       end || ' por ' || private.forma_de_pago(p.provider)
         || ' — ' || r.buyer_full_name || ' (' || r.tracking_code || ')',
       coalesce(t.account_code, '1111'),
       p.amount_bob, 0::numeric,
       p.id, 'pago'
  from public.payments p
  join public.reservations r on r.id = p.reservation_id
  left join public.treasury_accounts t on t.id = p.treasury_account_id
 where p.status = 'aprobado' and p.verified_at is not null
union all
-- El capital: baja la cuenta por cobrar de la venta viva; si la venta murió,
-- la plata cobrada queda como anticipo a resolver.
select p.project_id,
       (p.verified_at at time zone 'America/La_Paz')::date,
       'PAGO-' || p.reference_code,
       case p.purpose
         when 'cuota'    then 'Cobro de cuota'
         when 'abono'    then 'Abono al lote'
         when 'comision' then 'Comisión del mercado de traspasos'
         else 'Cobro de seña / reserva'
       end || ' por ' || private.forma_de_pago(p.provider)
         || ' — ' || r.buyer_full_name || ' (' || r.tracking_code || ')',
       case
         when p.purpose = 'comision' then '4211'
         when b.cadena_viva then '1131'
         else '2131'
       end,
       0::numeric,
       p.amount_bob - coalesce(p.interest_bob, 0),
       p.id, 'pago'
  from public.payments p
  join base_venta b on b.id = p.reservation_id
  join public.reservations r on r.id = p.reservation_id
 where p.status = 'aprobado' and p.verified_at is not null
   and p.amount_bob - coalesce(p.interest_bob, 0) <> 0
union all
-- El interés: ingreso financiero, nunca precio del terreno.
select p.project_id,
       (p.verified_at at time zone 'America/La_Paz')::date,
       'PAGO-' || p.reference_code,
       'Interés de financiamiento — ' || r.buyer_full_name || ' (' || r.tracking_code || ')',
       '4311'::text,
       0::numeric, p.interest_bob,
       p.id, 'pago'
  from public.payments p
  join public.reservations r on r.id = p.reservation_id
 where p.status = 'aprobado' and p.verified_at is not null
   and coalesce(p.interest_bob, 0) > 0
union all
select e.project_id, e.incurred_on,
       'EGR-' || left(replace(e.id::text, '-', ''), 10),
       e.description || coalesce(' — ' || coalesce(c.name, e.supplier), ''),
       case e.category
         when 'obra' then '5111' when 'comisiones' then '5211'
         when 'sueldos' then '5221' when 'publicidad' then '5311'
         when 'administracion' then '5411' when 'impuestos' then '5511'
         when 'financiero' then '5611' else '5911'
       end,
       e.amount_bob, 0::numeric, e.id, 'egreso'
  from public.expenses e
  left join public.contacts c on c.id = e.contact_id
 where e.deleted_at is null
union all
select e.project_id, e.incurred_on,
       'EGR-' || left(replace(e.id::text, '-', ''), 10),
       e.description || coalesce(' — ' || coalesce(c.name, e.supplier), ''),
       coalesce(t.account_code, '1111'),
       0::numeric, e.amount_bob, e.id, 'egreso'
  from public.expenses e
  left join public.treasury_accounts t on t.id = e.treasury_account_id
  left join public.contacts c on c.id = e.contact_id
 where e.deleted_at is null
union all
select je.project_id, je.entry_date, je.number,
       je.glosa || coalesce(' — ' || jl.glosa, ''),
       jl.account_code, jl.debe, jl.haber, je.id, 'comprobante'
  from public.journal_entries je
  join public.journal_lines jl on jl.entry_id = je.id
 where je.status = 'registrado';
