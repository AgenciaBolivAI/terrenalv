-- El diario deja de mandar todo a "1111 Caja y Bancos" y usa la cuenta del
-- banco o caja por donde realmente pasó la plata. Los movimientos viejos, sin
-- cuenta asignada, siguen cayendo en 1111 — no se les inventa un origen.

create or replace view public.v_libro_diario
with (security_invoker = true) as
-- Venta reconocida al confirmar: nace la cuenta por cobrar y el ingreso.
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
-- Cobro: entra a la cuenta de tesorería donde se depositó.
select p.project_id,
       (p.verified_at at time zone 'America/La_Paz')::date,
       'PAGO-' || p.reference_code,
       (case when p.purpose = 'cuota' then 'Cobro de cuota' else 'Cobro de seña / reserva' end)
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
         || ' — ' || r.buyer_full_name || ' (' || r.tracking_code || ')',
       case when r.confirmed_at is not null then '1131' else '2131' end,
       0::numeric, p.amount_bob, p.id, 'pago'
  from public.payments p
  join public.reservations r on r.id = p.reservation_id
 where p.status = 'aprobado' and p.verified_at is not null
union all
-- Egreso: el gasto al debe, y al haber la cuenta de donde salió la plata.
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
-- Comprobantes manuales y traspasos entre cuentas.
select je.project_id, je.entry_date, je.number,
       je.glosa || coalesce(' — ' || jl.glosa, ''),
       jl.account_code, jl.debe, jl.haber, je.id, 'comprobante'
  from public.journal_entries je
  join public.journal_lines jl on jl.entry_id = je.id
 where je.status = 'registrado';

grant select on public.v_libro_diario to authenticated;
