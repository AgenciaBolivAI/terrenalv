-- Blindaje que dejó la auditoría de 12 lentes (hallazgos CONFIRMADOS):
--
-- 1. admin_register_cuota_payment aceptaba cobros sobre reservas canceladas o
--    traspasadas y sin tope de saldo: dos vías para romper el invariante
--    1131 == Σ saldos sin que ningún check gritara. Y dos cobros simultáneos
--    del mismo plan podían imputar la misma cuota dos veces (sin lock).
-- 2. El cobro con fecha elegida se guardaba a medianoche UTC: en La Paz
--    (UTC-4) el libro, el historial y el recibo lo mostraban el día ANTERIOR.
--    Y la cuota quedaba «pagada el (hoy)» aunque el cobro fuera retroactivo.
-- 3. admin_anular_venta dejaba: el plan de cuotas activo (mora fantasma), el
--    aviso del mercado en la vidriera, y — si se anulaba la cabeza de una
--    cadena de traspasos — los antecesores con 'traspasada_a' vivo, cuyos
--    pagos seguían acreditando 1131 contra un saldo que ya no existía.
-- 4. El traspaso cancelaba el plan pero dejaba sus cuotas en 'pendiente':
--    21 cuotas muertas seguían sumando mora en el aging.

-- ---- 1. El cobro, blindado.
create or replace function public.admin_register_cuota_payment(
  p_reservation_id uuid,
  p_amount numeric,
  p_paid_on date default null,
  p_provider public.payment_provider_kind default 'efectivo',
  p_reference text default null,
  p_note text default null,
  p_treasury_account_id uuid default null,
  p_currency char(3) default 'BOB',
  p_exchange_rate numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid;
  v_res public.reservations%rowtype;
  v_plan public.installment_plans%rowtype;
  v_project public.projects%rowtype;
  v_mz_code text;
  v_lot_number text;
  v_cur char(3);
  v_rate numeric(10,4);
  v_amount_bob numeric(12,2);
  v_fecha timestamptz;
  v_saldo numeric(14,2);
  v_pay_id uuid;
  v_ref text;
  v_left numeric(12,2);
  v_take numeric(12,2);
  v_applied numeric(12,2) := 0;
  v_cuotas int := 0;
  v_row record;
  v_try int := 0;
  v_purpose text;
begin
  v_actor := private.assert_accounting();

  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  v_cur := upper(coalesce(nullif(btrim(coalesce(p_currency, '')), ''), 'BOB'));
  if v_cur not in ('BOB', 'USD') then raise exception 'INVALID_CURRENCY'; end if;

  -- FOR UPDATE: dos cobros simultáneos de la misma venta se serializan acá,
  -- así la cascada del segundo ve las cuotas como las dejó el primero.
  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  -- Solo una venta VIVA se cobra: la cadena de un traspaso se cobra por su
  -- punta (la venta nueva), y una anulada no tiene saldo que bajar. Un pago
  -- acá acreditaría 1131 sin bajar ningún saldo de pantalla.
  if v_res.status <> 'confirmada' then raise exception 'NO_ES_VENTA'; end if;

  select * into v_plan from public.installment_plans
   where reservation_id = p_reservation_id and status = 'activo';
  v_purpose := case when found then 'cuota' else 'abono' end;

  if p_treasury_account_id is not null
     and not exists (select 1 from public.treasury_accounts
                      where id = p_treasury_account_id and is_active) then
    raise exception 'TREASURY_NOT_FOUND';
  end if;

  select * into v_project from public.projects where id = v_res.project_id;
  select m.code, l.number into v_mz_code, v_lot_number
    from public.lots l join public.manzanas m on m.id = l.manzana_id
   where l.id = v_res.lot_id;

  v_rate := coalesce(p_exchange_rate,
                     (private.get_setting(v_res.project_id, 'exchange_rate_bob_per_usd'))::numeric,
                     6.96);
  if v_cur = 'USD' and (v_rate < 1 or v_rate > 100) then
    raise exception 'INVALID_EXCHANGE_RATE';
  end if;

  v_amount_bob := case when v_cur = 'BOB' then p_amount else round(p_amount * v_rate, 2) end;

  -- Tope de saldo: la MISMA cuenta que hace v_ventas. Cobrar de más dejaría
  -- el saldo clavado en 0 mientras el libro sigue bajando la cuenta por
  -- cobrar — el invariante 1131 == Σ saldos se rompería en silencio.
  select greatest(0,
           coalesce((v_res.client_meta->'reportado'->>'deuda')::numeric, v_res.price_agreed)
           - coalesce((select sum(x.amount_bob) from public.payments x
                        where x.reservation_id = p_reservation_id
                          and x.status = 'aprobado'
                          and x.purpose in ('cuota','abono')), 0))
    into v_saldo;
  if v_amount_bob > v_saldo + 0.01 then
    raise exception 'MONTO_EXCEDE_SALDO'
      using detail = format('saldo %s, cobro %s', v_saldo, v_amount_bob);
  end if;

  -- La fecha elegida se asienta al MEDIODÍA de La Paz: guardarla a
  -- medianoche UTC la corría al día anterior en cada pantalla y en el recibo.
  v_fecha := case when p_paid_on is null then now()
                  else (p_paid_on::text || ' 12:00:00')::timestamp at time zone 'America/La_Paz'
             end;

  loop
    v_try := v_try + 1;
    v_ref := coalesce(nullif(btrim(coalesce(p_reference, '')), ''),
                      v_project.tracking_prefix || '-C-' || replace(coalesce(v_mz_code, ''), '-', '')
                      || '-' || coalesce(v_lot_number, '') || '-' || private.gen_code(4));
    begin
      insert into public.payments
        (project_id, reservation_id, provider, reference_code, purpose, amount, currency,
         amount_bob, exchange_rate_used, status, verified_by, verified_at, rejection_note,
         treasury_account_id)
      values
        (v_res.project_id, v_res.id, p_provider, v_ref, v_purpose, p_amount, v_cur,
         v_amount_bob, v_rate, 'aprobado', v_actor, v_fecha, p_note, p_treasury_account_id)
      returning id into v_pay_id;
      exit;
    exception when unique_violation then
      if v_try >= 3 or nullif(btrim(coalesce(p_reference, '')), '') is not null then raise; end if;
    end;
  end loop;

  if v_purpose = 'cuota' then
    v_left := v_amount_bob;
    for v_row in
      select id, amount - amount_paid as falta
        from public.installments
       where plan_id = v_plan.id and status in ('pendiente', 'parcial')
       order by number
       for update
    loop
      exit when v_left <= 0;
      v_take := least(v_left, v_row.falta);
      if v_take > 0 then
        insert into public.payment_allocations (payment_id, installment_id, amount)
        values (v_pay_id, v_row.id, v_take);
        v_left := round(v_left - v_take, 2);
        v_applied := round(v_applied + v_take, 2);
        v_cuotas := v_cuotas + 1;
      end if;
    end loop;

    -- La cuota saldada con un cobro retroactivo queda pagada EN ESA fecha,
    -- no hoy: el recalc pone now() y acá se corrige a la fecha real.
    update public.installments i
       set paid_at = v_fecha, updated_at = now()
     where i.status = 'pagada' and coalesce(i.paid_at, now()) > v_fecha
       and exists (select 1 from public.payment_allocations pa
                    where pa.installment_id = i.id and pa.payment_id = v_pay_id);
  end if;

  perform private.audit('team', v_actor, null,
    case when v_purpose = 'cuota' then 'cuota.registered' else 'abono.registered' end,
    v_res.project_id, 'reservation', v_res.id,
    null, jsonb_build_object('payment_id', v_pay_id, 'monto', p_amount, 'moneda', v_cur,
                             'cambio', v_rate, 'monto_bob', v_amount_bob, 'tipo', v_purpose,
                             'forma', p_provider,
                             'aplicado', v_applied, 'sobrante', v_left, 'cuotas', v_cuotas));

  return jsonb_build_object(
    'payment_id', v_pay_id, 'reference_code', v_ref, 'tipo', v_purpose,
    'moneda', v_cur, 'cambio', v_rate, 'monto_bob', v_amount_bob,
    'aplicado', v_applied, 'sobrante', coalesce(v_left, 0), 'cuotas_afectadas', v_cuotas);
end;
$fn$;

-- ---- 2. Anular una venta cierra TODO lo que colgaba de ella.
create or replace function public.admin_anular_venta(p_reservation_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid;
  v_res public.reservations%rowtype;
  v_prev uuid;
  v_cadena int := 0;
begin
  v_actor := private.assert_admin();
  if btrim(coalesce(p_note, '')) = '' then raise exception 'NOTE_REQUIRED'; end if;

  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if v_res.status <> 'confirmada' then raise exception 'NO_ES_VENTA'; end if;

  update public.reservations
     set status = 'cancelada', cancelled_at = now(), cancel_reason = btrim(p_note),
         updated_at = now()
   where id = p_reservation_id;

  update public.lots
     set status = 'disponible', active_reservation_id = null
   where id = v_res.lot_id and active_reservation_id = p_reservation_id;

  -- El plan muere con la venta, y sus cuotas también: dejarlas pendientes es
  -- mora fantasma en el aging y en la proyección.
  update public.installments i
     set status = 'anulada', updated_at = now()
    from public.installment_plans pl
   where pl.reservation_id = p_reservation_id and i.plan_id = pl.id
     and i.status in ('pendiente', 'parcial');
  update public.installment_plans
     set status = 'cancelado',
         note = coalesce(note || ' · ', '') || 'venta anulada', updated_at = now()
   where reservation_id = p_reservation_id and status = 'activo';

  -- El aviso del mercado sale de la vidriera: el lote ya no es de este vendedor.
  update public.market_listings
     set status = 'cerrada', closed_reason = 'venta anulada', updated_at = now()
   where reservation_id = p_reservation_id and status in ('activa','pausada');

  -- Si esta venta era la cabeza de una cadena de traspasos, los antecesores
  -- quedaban con 'traspasada_a' vivo y sus pagos seguían acreditando la
  -- cuenta por cobrar de un saldo que ya no existe. La cadena se neutraliza:
  -- la marca se guarda como 'traspasada_a_anulada' (la historia no se borra)
  -- y esos pagos pasan a anticipos (2131), como en cualquier venta anulada.
  v_prev := (v_res.client_meta->'traspaso'->>'de_reservation')::uuid;
  while v_prev is not null loop
    update public.reservations
       set client_meta = (client_meta - 'traspasada_a')
             || jsonb_build_object('traspasada_a_anulada',
                  coalesce(client_meta->'traspasada_a', 'null'::jsonb)),
           updated_at = now()
     where id = v_prev and client_meta ? 'traspasada_a';
    exit when not found;
    v_cadena := v_cadena + 1;
    select (client_meta->'traspaso'->>'de_reservation')::uuid into v_prev
      from public.reservations where id = v_prev;
  end loop;

  perform private.audit('team', v_actor, null, 'venta.anulada', v_res.project_id,
    'reservation', p_reservation_id,
    jsonb_build_object('comprador', v_res.buyer_full_name, 'precio', v_res.price_agreed),
    jsonb_build_object('motivo', btrim(p_note), 'antecesores_neutralizados', v_cadena));

  return jsonb_build_object('ok', true, 'antecesores_neutralizados', v_cadena);
end;
$fn$;

-- ---- 3. El traspaso también anula las cuotas del plan que cancela.
do $patch$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='admin_traspasar_venta';
  if position('anulada' in v_def) > 0 then return; end if;
  v_def := replace(v_def,
    $$update public.installment_plans
     set status = 'cancelado', note = coalesce(note || ' · ', '') || 'traspaso', updated_at = now()
   where reservation_id = p_reservation_id and status = 'activo';$$,
    $$update public.installments i
     set status = 'anulada', updated_at = now()
    from public.installment_plans pl
   where pl.reservation_id = p_reservation_id and pl.status = 'activo'
     and i.plan_id = pl.id and i.status in ('pendiente', 'parcial');

  update public.installment_plans
     set status = 'cancelado', note = coalesce(note || ' · ', '') || 'traspaso', updated_at = now()
   where reservation_id = p_reservation_id and status = 'activo';$$);
  if position('anulada' in v_def) = 0 then
    raise exception 'PATCH_NO_APLICADO: no se encontró el bloque del plan en admin_traspasar_venta';
  end if;
  execute v_def;
end;
$patch$;

-- ---- 4. Los datos ya heridos: cuotas vivas de planes muertos → anuladas.
update public.installments i
   set status = 'anulada', updated_at = now()
  from public.installment_plans pl
 where i.plan_id = pl.id and pl.status <> 'activo'
   and i.status in ('pendiente', 'parcial');

-- ---- 5. Un solo plan activo por venta, garantizado por índice.
create unique index if not exists installment_plans_one_active_uidx
  on public.installment_plans (reservation_id) where status = 'activo';
