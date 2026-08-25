-- Por dónde entró cada cobro: efectivo, QR, o depósito bancario.
--
-- El dato se venía guardando desde el principio (payments.provider) pero no se
-- mostraba en ninguna parte de contabilidad: ni en el estado de cuenta, ni en
-- el libro, ni en ningún reporte. Para el contador es de las primeras cosas
-- que necesita: el efectivo hay que arquearlo y depositarlo, el QR aparece en
-- el extracto del banco, y cuadrar caja sin poder separarlos es imposible.

create or replace function private.forma_de_pago(p public.payment_provider_kind)
returns text
language sql
immutable
as $$
  select case p
    when 'efectivo'        then 'Efectivo'
    when 'manual_qr'       then 'QR / transferencia'
    when 'banco_ganadero'  then 'Banco Ganadero'
    when 'bnb'             then 'BNB'
    else 'Otro'
  end;
$$;

grant execute on function private.forma_de_pago(public.payment_provider_kind)
  to anon, authenticated, service_role;

-- El libro diario dice cómo entró la plata, no sólo cuánta.
create or replace view public.v_libro_diario
with (security_invoker = true) as
select r.project_id,
       (r.confirmed_at at time zone 'America/La_Paz')::date as fecha,
       'VTA-' || r.tracking_code as comprobante,
       'Venta de lote — ' || r.buyer_full_name as glosa,
       '1131'::text as cuenta, r.price_agreed as debe, 0::numeric as haber,
       r.id as origen_id, 'venta'::text as origen
  from public.reservations r where r.confirmed_at is not null
union all
select r.project_id,
       (r.confirmed_at at time zone 'America/La_Paz')::date,
       'VTA-' || r.tracking_code,
       'Venta de lote — ' || r.buyer_full_name,
       '4111', 0::numeric, r.price_agreed, r.id, 'venta'
  from public.reservations r where r.confirmed_at is not null
union all
select p.project_id,
       (p.verified_at at time zone 'America/La_Paz')::date,
       'PAGO-' || p.reference_code,
       (case when p.purpose = 'cuota' then 'Cobro de cuota' else 'Cobro de seña / reserva' end)
         || ' por ' || private.forma_de_pago(p.provider)
         || ' — ' || r.buyer_full_name || ' (' || r.tracking_code || ')',
       coalesce(t.account_code, '1111'), p.amount_bob, 0::numeric, p.id, 'pago'
  from public.payments p
  join public.reservations r on r.id = p.reservation_id
  left join public.treasury_accounts t on t.id = p.treasury_account_id
 where p.status = 'aprobado' and p.verified_at is not null
union all
select p.project_id,
       (p.verified_at at time zone 'America/La_Paz')::date,
       'PAGO-' || p.reference_code,
       (case when p.purpose = 'cuota' then 'Cobro de cuota' else 'Cobro de seña / reserva' end)
         || ' por ' || private.forma_de_pago(p.provider)
         || ' — ' || r.buyer_full_name || ' (' || r.tracking_code || ')',
       case when r.confirmed_at is not null then '1131' else '2131' end,
       0::numeric, p.amount_bob, p.id, 'pago'
  from public.payments p
  join public.reservations r on r.id = p.reservation_id
 where p.status = 'aprobado' and p.verified_at is not null
union all
select e.project_id, e.incurred_on,
       'EGR-' || left(replace(e.id::text, '-', ''), 10),
       e.description || coalesce(' — ' || coalesce(c.name, e.supplier), ''),
       case e.category
         when 'obra'           then '5111' when 'comisiones'     then '5211'
         when 'sueldos'        then '5221' when 'publicidad'     then '5311'
         when 'administracion' then '5411' when 'impuestos'      then '5511'
         when 'financiero'     then '5611' else '5911' end,
       e.amount_bob, 0::numeric, e.id, 'egreso'
  from public.expenses e
  left join public.contacts c on c.id = e.contact_id
 where e.deleted_at is null
union all
select e.project_id, e.incurred_on,
       'EGR-' || left(replace(e.id::text, '-', ''), 10),
       e.description || coalesce(' — ' || coalesce(c.name, e.supplier), ''),
       coalesce(t.account_code, '1111'), 0::numeric, e.amount_bob, e.id, 'egreso'
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

grant select on public.v_libro_diario to authenticated;

-- Cuánto entró por cada vía, por mes. El efectivo se arquea y se deposita; el
-- QR tiene que aparecer en el extracto. Separarlos es el primer paso para
-- cuadrar la caja.
create or replace view public.v_an_cobros_por_via
with (security_invoker = true) as
select p.project_id,
       date_trunc('month', (p.verified_at at time zone 'America/La_Paz'))::date as mes,
       p.provider,
       private.forma_de_pago(p.provider) as forma,
       p.purpose,
       count(*) as cobros,
       sum(p.amount_bob) as total_bob
  from public.payments p
 where p.status = 'aprobado' and p.verified_at is not null
 group by 1, 2, 3, 4, 5;

grant select on public.v_an_cobros_por_via to authenticated;
