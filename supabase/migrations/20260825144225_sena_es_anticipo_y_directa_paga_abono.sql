-- Dos incoherencias que destapó el invariante «1131 = suma de saldos en
-- pantalla» (fallaba por Bs 6.000 exactos: las seis señas).
--
-- 1. LA SEÑA ES UN ANTICIPO, NO UN COBRO DEL PRECIO. La regla comercial de
--    Terrenalv es que la seña asegura el lote y la cuota inicial arranca la
--    compra — son cosas distintas a propósito, y las pantallas ya lo dicen
--    («la seña no descuenta el saldo»). Pero el libro la acreditaba contra la
--    cuenta por cobrar, así que libro y pantalla se contradecían por el monto
--    de cada seña. Ahora la seña acredita SIEMPRE anticipos (2131): plata
--    recibida que la empresa decide después si aplica al precio (con un
--    comprobante) o retiene si la reserva cae.
--
-- 2. LA VENTA DIRECTA REGISTRABA SU PLATA COMO SEÑA. mark_sold_offline creaba
--    el pago con propósito 'reserva', y como la seña no descuenta el saldo, un
--    comprador que entró pagando Bs 25.000 aparecía con pagado 0 y debiendo el
--    precio entero. En una venta directa no hay seña: esa plata ES pago del
--    lote, y entra como abono.

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
       '1131'::text as cuenta, r.monto_venta as debe, 0::numeric as haber,
       r.id as origen_id, 'venta'::text as origen
  from base_venta r
 where r.confirmed_at is not null and r.status = 'confirmada'
union all
select r.project_id,
       (r.confirmed_at at time zone 'America/La_Paz')::date,
       'VTA-' || r.tracking_code,
       'Venta de lote — ' || r.buyer_full_name,
       '4111', 0::numeric, r.monto_venta, r.id, 'venta'
  from base_venta r
 where r.confirmed_at is not null and r.status = 'confirmada'
union all
select p.project_id,
       (p.verified_at at time zone 'America/La_Paz')::date,
       'PAGO-' || p.reference_code,
       (case p.purpose when 'cuota' then 'Cobro de cuota'
                       when 'abono' then 'Abono al lote'
                       else 'Cobro de seña / reserva' end)
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
       (case p.purpose when 'cuota' then 'Cobro de cuota'
                       when 'abono' then 'Abono al lote'
                       else 'Cobro de seña / reserva' end)
         || ' por ' || private.forma_de_pago(p.provider)
         || ' — ' || r.buyer_full_name || ' (' || r.tracking_code || ')',
       case
         when p.purpose = 'reserva' then '2131'
         when b.cadena_viva then '1131'
         else '2131'
       end,
       0::numeric, p.amount_bob, p.id, 'pago'
  from public.payments p
  join base_venta b on b.id = p.reservation_id
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

-- La venta directa entra pagando ABONO, no seña.
create or replace function public.mark_sold_offline(
  p_lot_id uuid, p_full_name text, p_ci text, p_phone text,
  p_email text default null, p_amount numeric default null, p_note text default null,
  p_provider public.payment_provider_kind default 'manual_qr'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $function$
declare
  v_actor uuid; v_lot public.lots%rowtype; v_project public.projects%rowtype;
  v_mz_code text; v_price numeric(12,2); v_rate numeric(10,4); v_amount numeric(12,2);
  v_code text; v_ref text; v_res_id uuid; v_email text;
begin
  v_actor := private.assert_admin();
  v_email := private.exigir_correo(p_email);

  update public.lots set status = 'vendido'
   where id = p_lot_id and status = 'disponible' and deleted_at is null
  returning * into v_lot;
  if not found then raise exception 'LOT_NOT_AVAILABLE'; end if;

  select * into v_project from public.projects where id = v_lot.project_id;
  select code into v_mz_code from public.manzanas where id = v_lot.manzana_id;
  v_price := coalesce(public.lot_price(v_lot.id), 0);
  v_amount := coalesce(p_amount, v_price);
  v_rate := coalesce((private.get_setting(v_lot.project_id, 'exchange_rate_bob_per_usd'))::numeric, 6.96);

  v_code := private.gen_tracking_code(v_project.tracking_prefix);
  insert into public.reservations
    (project_id, lot_id, tracking_code, buyer_full_name, buyer_ci, buyer_ci_normalized,
     buyer_phone, buyer_email, status, price_agreed, amount_due, amount_due_currency,
     currency, source, verified_by, confirmed_at, client_meta)
  values
    (v_lot.project_id, v_lot.id, v_code, btrim(p_full_name), p_ci, private.normalize_ci(p_ci),
     private.normalize_phone_bo(p_phone), v_email, 'confirmada',
     v_price, v_amount, v_project.currency, v_project.currency, 'oficina', v_actor, now(),
     jsonb_build_object('origen', 'oficina_directa'))
  returning id into v_res_id;

  update public.lots set active_reservation_id = v_res_id where id = v_lot.id;

  v_ref := v_project.tracking_prefix || '-' || replace(v_mz_code, '-', '') || '-'
           || v_lot.number || '-' || private.gen_code(4);
  insert into public.payments
    (project_id, reservation_id, provider, reference_code, purpose, amount, currency,
     amount_bob, exchange_rate_used, status, verified_by, verified_at, rejection_note)
  values
    -- ABONO: en una venta directa no hay seña — la plata cobrada ES pago del
    -- lote, descuenta el saldo, y la compra queda iniciada.
    (v_lot.project_id, v_res_id, coalesce(p_provider, 'manual_qr'), v_ref, 'abono',
     v_amount, v_project.currency,
     case when v_project.currency = 'BOB' then v_amount else round(v_amount * v_rate, 2) end,
     v_rate, 'aprobado', v_actor, now(), p_note);

  perform private.audit('team', v_actor, null, 'lot.sold_offline', v_lot.project_id,
    'reservation', v_res_id, null,
    jsonb_build_object('lot_id', v_lot.id, 'monto', v_amount, 'origen', 'oficina_directa',
                       'forma_de_pago', coalesce(p_provider, 'manual_qr'), 'nota', p_note));

  return jsonb_build_object('tracking_code', v_code, 'reservation_id', v_res_id);
end;
$function$;

grant execute on function public.mark_sold_offline(
  uuid, text, text, text, text, numeric, text, public.payment_provider_kind)
  to authenticated, service_role;
