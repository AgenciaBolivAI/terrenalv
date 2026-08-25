-- El traspaso (y la anulación) atraviesan TODO: libro, analítica, saldos.
--
-- Al conectar el traspaso con los libros apareció un error que ya existía: el
-- diario reconocía la venta por `confirmed_at`, sin mirar el estado. Con eso,
-- un lote traspasado contaba su venta DOS veces (la cerrada y la nueva), y una
-- venta anulada dejaba su ingreso en el estado de resultados para siempre.
--
-- Reglas nuevas, una sola vez y en la vista — no en cada pantalla:
--
-- 1. INGRESO: se reconoce una vez por cadena de venta.
--    * venta viva normal → su precio;
--    * venta viva migrada → la deuda reportada (la plata que el comprador pagó
--      en el sistema anterior nunca pasó por ESTOS libros: reconocerla acá
--      inflaría el resultado de hoy con ventas de otros años);
--    * venta viva por traspaso → la base ORIGINAL de la cadena (guardada al
--      traspasar): el ingreso se ganó cuando el lote se vendió la primera vez,
--      y el traspaso no lo duplica ni lo borra.
--    * venta cerrada (anulada o traspasada) → ningún ingreso.
--
-- 2. COBROS: acreditan la cuenta por cobrar (1131) mientras la cadena siga
--    viva — los pagos del comprador anterior son parte de la misma cadena, y
--    así 1131 da EXACTAMENTE el saldo que muestran las pantallas. Si la venta
--    se anuló sin sucesor, acreditan anticipos (2131): esa plata quedó
--    debiéndose resolver (devolución), no es ingreso ni baja ninguna cuenta
--    por cobrar.

-- ---- El RPC guarda lo que el libro necesita: la base original de la cadena
--      y la fecha de la venta original (para que la colocación no cuente el
--      traspaso como una venta nueva del mes).
create or replace function public.admin_traspasar_venta(
  p_reservation_id uuid, p_full_name text, p_ci text, p_phone text,
  p_email text default null, p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid;
  v_vieja public.reservations%rowtype;
  v_project public.projects%rowtype;
  v_email text;
  v_pagado numeric(14,2);
  v_saldo numeric(14,2);
  v_base numeric(14,2);
  v_base_original numeric(14,2);
  v_confirmado_original timestamptz;
  v_code text;
  v_nueva uuid;
  v_try int := 0;
begin
  v_actor := private.assert_accounting();

  if btrim(coalesce(p_full_name, '')) = '' then raise exception 'BUYER_NAME_REQUIRED'; end if;
  if coalesce(private.normalize_ci(p_ci), '') = '' then raise exception 'BUYER_CI_REQUIRED'; end if;
  if coalesce(private.normalize_phone_bo(p_phone), '') = '' then raise exception 'BUYER_PHONE_REQUIRED'; end if;
  v_email := private.exigir_correo(p_email);
  if btrim(coalesce(p_note, '')) = '' then raise exception 'NOTE_REQUIRED'; end if;

  select * into v_vieja from public.reservations where id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if v_vieja.status <> 'confirmada' then raise exception 'NO_ES_VENTA'; end if;

  select * into v_project from public.projects where id = v_vieja.project_id;

  select coalesce(sum(x.amount_bob), 0) into v_pagado
    from public.payments x
   where x.reservation_id = p_reservation_id
     and x.status = 'aprobado' and x.purpose <> 'reserva';
  v_base := coalesce((v_vieja.client_meta->'reportado'->>'deuda')::numeric, v_vieja.price_agreed);
  v_saldo := greatest(0, v_base - v_pagado);
  v_pagado := v_pagado + coalesce((v_vieja.client_meta->'reportado'->>'abonado')::numeric, 0);

  -- La base y la fecha ORIGINALES viajan por la cadena: si esta venta ya venía
  -- de un traspaso, se conservan las del eslabón primero.
  v_base_original := coalesce(
    (v_vieja.client_meta->'traspaso'->>'baseline_original')::numeric, v_base);
  v_confirmado_original := coalesce(
    (v_vieja.client_meta->'traspaso'->>'confirmado_original')::timestamptz,
    v_vieja.confirmed_at);

  update public.installment_plans
     set status = 'cancelado', note = coalesce(note || ' · ', '') || 'traspaso', updated_at = now()
   where reservation_id = p_reservation_id and status = 'activo';

  update public.reservations
     set status = 'cancelada', cancelled_at = now(),
         cancel_reason = 'Traspaso — ' || btrim(p_note),
         updated_at = now()
   where id = p_reservation_id;

  loop
    v_try := v_try + 1;
    v_code := private.gen_tracking_code(v_project.tracking_prefix);
    begin
      insert into public.reservations
        (project_id, lot_id, tracking_code, buyer_full_name, buyer_ci, buyer_ci_normalized,
         buyer_phone, buyer_email, status, price_agreed, amount_due, amount_due_currency,
         currency, source, verified_by, confirmed_at, client_meta)
      values
        (v_vieja.project_id, v_vieja.lot_id, v_code, btrim(p_full_name), p_ci,
         private.normalize_ci(p_ci), private.normalize_phone_bo(p_phone), v_email,
         'confirmada', v_vieja.price_agreed, 0, 'BOB', 'BOB', 'oficina', v_actor, now(),
         jsonb_build_object(
           'origen', 'traspaso',
           'reportado', jsonb_build_object('abonado', v_pagado, 'deuda', v_saldo),
           'traspaso', jsonb_build_object(
             'de_reservation', v_vieja.id,
             'de_tracking', v_vieja.tracking_code,
             'de_comprador', v_vieja.buyer_full_name,
             'de_ci', v_vieja.buyer_ci,
             'fecha', now(),
             'pagado_arrastrado', v_pagado,
             'saldo_arrastrado', v_saldo,
             'baseline_original', v_base_original,
             'confirmado_original', v_confirmado_original,
             'motivo', btrim(p_note))))
      returning id into v_nueva;
      exit;
    exception when unique_violation then
      if v_try >= 3 or sqlerrm not like '%tracking_code%' then raise; end if;
    end;
  end loop;

  update public.reservations
     set cancel_reason = 'Traspaso a ' || v_code || ' — ' || btrim(p_note),
         client_meta = coalesce(client_meta, '{}'::jsonb)
           || jsonb_build_object('traspasada_a', jsonb_build_object(
                'reservation', v_nueva, 'tracking', v_code,
                'comprador', btrim(p_full_name), 'fecha', now()))
   where id = p_reservation_id;

  update public.lots
     set status = 'vendido', active_reservation_id = v_nueva
   where id = v_vieja.lot_id;

  perform private.audit('team', v_actor, null, 'venta.traspasada', v_vieja.project_id,
    'reservation', p_reservation_id,
    jsonb_build_object('comprador', v_vieja.buyer_full_name, 'tracking', v_vieja.tracking_code),
    jsonb_build_object('a', btrim(p_full_name), 'tracking_nuevo', v_code,
                       'pagado_arrastrado', v_pagado, 'saldo_arrastrado', v_saldo,
                       'motivo', btrim(p_note)));
  perform private.audit('team', v_actor, null, 'venta.recibida_traspaso', v_vieja.project_id,
    'reservation', v_nueva, null,
    jsonb_build_object('de', v_vieja.buyer_full_name, 'tracking_anterior', v_vieja.tracking_code));

  return jsonb_build_object(
    'reservation_id', v_nueva, 'tracking_code', v_code,
    'pagado_arrastrado', v_pagado, 'saldo_arrastrado', v_saldo);
end;
$fn$;

-- ---- El libro, con las dos reglas.
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
         -- La cadena sigue viva si la venta está confirmada o si fue
         -- traspasada (su sucesora carga con la cuenta por cobrar).
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
       case when b.cadena_viva then '1131' else '2131' end,
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

-- ---- Colocación: solo ventas vivas, cada lote UNA vez, y el traspaso cuenta
--      en el mes de la venta ORIGINAL — traspasar en agosto un lote vendido en
--      marzo no es haber colocado un lote en agosto.
create or replace view public.v_an_colocacion
with (security_invoker = true) as
select r.project_id,
       date_trunc('month', coalesce(
         (r.client_meta->'traspaso'->>'confirmado_original')::timestamptz,
         r.confirmed_at) at time zone 'America/La_Paz')::date as mes,
       count(*) as lotes_colocados,
       sum(r.price_agreed) as valor_colocado,
       round(avg(r.price_agreed), 2) as ticket_promedio,
       round(sum(r.price_agreed) / nullif(sum(l.area_m2), 0), 2) as precio_m2_realizado,
       count(*) filter (where r.source = 'oficina') as por_oficina,
       count(*) filter (where r.source = 'web') as por_web,
       sum(private.to_bob(r.price_agreed, r.currency, r.project_id)) as valor_colocado_bob,
       round(avg(private.to_bob(r.price_agreed, r.currency, r.project_id)), 2) as ticket_promedio_bob,
       round(sum(private.to_bob(r.price_agreed, r.currency, r.project_id))
             / nullif(sum(l.area_m2), 0), 2) as precio_m2_realizado_bob,
       sum(l.area_m2) as area_colocada,
       count(*) filter (where private.origen_de_venta(r.source, r.client_meta, r.created_at, r.confirmed_at) = 'app') as origen_app,
       count(*) filter (where private.origen_de_venta(r.source, r.client_meta, r.created_at, r.confirmed_at) = 'oficina_reserva') as origen_oficina_reserva,
       count(*) filter (where private.origen_de_venta(r.source, r.client_meta, r.created_at, r.confirmed_at) = 'oficina_directa') as origen_oficina_directa,
       count(*) filter (where private.origen_de_venta(r.source, r.client_meta, r.created_at, r.confirmed_at) = 'traspaso') as origen_traspaso,
       count(*) filter (where private.origen_de_venta(r.source, r.client_meta, r.created_at, r.confirmed_at) = 'migrada') as origen_migrada
  from public.reservations r
  join public.lots l on l.id = r.lot_id
 where r.confirmed_at is not null and r.status = 'confirmada'
 group by r.project_id, 2;

grant select on public.v_an_colocacion to authenticated;

-- ---- Traspasos, para monitorearlos: cuántos, cuándo y cuánta plata cambió
--      de manos.
create or replace view public.v_an_traspasos
with (security_invoker = true) as
select r.project_id,
       date_trunc('month', ((r.client_meta->'traspaso'->>'fecha')::timestamptz)
                  at time zone 'America/La_Paz')::date as mes,
       count(*) as traspasos,
       sum((r.client_meta->'traspaso'->>'pagado_arrastrado')::numeric) as pagado_arrastrado,
       sum((r.client_meta->'traspaso'->>'saldo_arrastrado')::numeric) as saldo_arrastrado
  from public.reservations r
 where r.client_meta ? 'traspaso' and r.status = 'confirmada'
 group by r.project_id, 2;

grant select on public.v_an_traspasos to authenticated;
