-- Cobrar la seña en el mostrador SOSTIENE la reserva; no la vuelve venta.
--
-- Cómo era: la seña solo entraba al libro si el comprador subía un
-- comprobante por la web y alguien lo aprobaba — y aprobarlo convertía la
-- reserva en VENTA en el acto. Con eso, la plata que se cobra en efectivo en
-- el mostrador NUNCA entraba a los libros (el pago quedaba «pendiente» para
-- siempre), y no existía el estado real del negocio: «pagó la seña, le
-- guardamos el lote, está juntando la cuota inicial».
--
-- Cómo es ahora: se cobra la seña, entra al libro como anticipo, y el lote
-- queda guardado por un plazo configurable. En ese plazo el comprador abona a
-- cuenta de su cuota inicial. Cuando la completa, la reserva se vuelve venta
-- sola. Si el plazo vence sin completarla, el lote vuelve a la vitrina y la
-- seña se pierde.

insert into public.settings (project_id, key, value, is_public)
select null, 'dias_para_inicial', '30'::jsonb, false
 where not exists (select 1 from public.settings
                    where key = 'dias_para_inicial' and project_id is null);

-- ---- Cobrar la seña en el mostrador.
create or replace function public.admin_cobrar_sena(
  p_reservation_id uuid,
  p_amount numeric default null,
  p_provider public.payment_provider_kind default 'efectivo',
  p_treasury_account_id uuid default null,
  p_dias int default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid; v_res public.reservations%rowtype; v_project public.projects%rowtype;
  v_pay public.payments%rowtype; v_monto numeric(12,2); v_dias int;
  v_hasta timestamptz; v_ref text; v_id uuid; v_try int := 0;
begin
  v_actor := private.assert_accounting();

  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if v_res.status not in ('pendiente_pago','en_verificacion','rechazo_reintento') then
    raise exception 'RESERVA_NO_VIVA'
      using detail = 'La reserva está ' || v_res.status || '.';
  end if;

  select * into v_project from public.projects where id = v_res.project_id;

  -- El plazo para juntar la cuota inicial: el que indique la oficina, o el
  -- configurado.
  v_dias := coalesce(p_dias,
                     (private.get_setting(v_res.project_id, 'dias_para_inicial'))::int,
                     30);
  if v_dias < 1 or v_dias > 365 then raise exception 'PLAZO_INVALIDO'; end if;
  v_hasta := now() + make_interval(days => v_dias);

  -- Si ya hay una seña esperando, se cobra ESA; si no, se crea.
  select * into v_pay from public.payments
   where reservation_id = p_reservation_id and purpose = 'reserva'
     and status in ('pendiente','comprobante_subido')
   order by created_at limit 1
   for update;

  v_monto := coalesce(p_amount, v_pay.amount, v_res.amount_due);
  if v_monto is null or v_monto <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  if p_treasury_account_id is not null
     and not exists (select 1 from public.treasury_accounts
                      where id = p_treasury_account_id and is_active) then
    raise exception 'TREASURY_NOT_FOUND';
  end if;

  if v_pay.id is not null then
    update public.payments
       set status = 'aprobado', verified_by = v_actor, verified_at = now(),
           amount = v_monto, amount_bob = v_monto, exchange_rate_used = 1,
           provider = p_provider, treasury_account_id = p_treasury_account_id,
           rejection_note = coalesce(p_note, rejection_note)
     where id = v_pay.id
    returning id into v_id;
  else
    loop
      v_try := v_try + 1;
      v_ref := v_project.tracking_prefix || '-S-' || private.gen_code(5);
      begin
        insert into public.payments
          (project_id, reservation_id, provider, reference_code, purpose, amount, currency,
           amount_bob, exchange_rate_used, status, verified_by, verified_at, rejection_note,
           treasury_account_id)
        values
          (v_res.project_id, v_res.id, p_provider, v_ref, 'reserva', v_monto, 'BOB',
           v_monto, 1, 'aprobado', v_actor, now(), p_note, p_treasury_account_id)
        returning id into v_id;
        exit;
      exception when unique_violation then
        if v_try >= 3 then raise; end if;
      end;
    end loop;
  end if;

  -- El lote queda guardado por el plazo, y la reserva sigue siendo RESERVA:
  -- todavía no hay venta, porque la cuota inicial no está completa.
  update public.reservations
     set status = 'pendiente_pago',
         hold_expires_at = v_hasta,
         retry_expires_at = null,
         updated_at = now()
   where id = p_reservation_id;

  update public.lots
     set status = 'reservado', active_reservation_id = p_reservation_id
   where id = v_res.lot_id and status in ('disponible','reservado');

  perform private.audit('team', v_actor, null, 'reserva.sena_cobrada', v_res.project_id,
    'reservation', p_reservation_id, null,
    jsonb_build_object('payment_id', v_id, 'monto', v_monto, 'forma', p_provider,
                       'dias', v_dias, 'guardado_hasta', v_hasta));

  return jsonb_build_object('payment_id', v_id, 'monto', v_monto,
                            'guardado_hasta', v_hasta, 'dias', v_dias);
end;
$fn$;

revoke execute on function public.admin_cobrar_sena(
  uuid, numeric, public.payment_provider_kind, uuid, int, text) from public, anon;
grant execute on function public.admin_cobrar_sena(
  uuid, numeric, public.payment_provider_kind, uuid, int, text)
  to authenticated, service_role;

-- ---- Convertir la reserva en venta: cuando la cuota inicial está completa,
--      o cuando la oficina lo decide.
create or replace function public.admin_confirmar_reserva(
  p_reservation_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare v_actor uuid; v_res public.reservations%rowtype;
begin
  v_actor := private.assert_accounting();

  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if v_res.status = 'confirmada' then raise exception 'YA_ES_VENTA'; end if;
  if v_res.status not in ('pendiente_pago','en_verificacion','rechazo_reintento') then
    raise exception 'RESERVA_NO_VIVA'
      using detail = 'La reserva está ' || v_res.status || '. Reactivala primero.';
  end if;

  update public.reservations
     set status = 'confirmada', confirmed_at = now(), verified_by = v_actor,
         hold_expires_at = null, retry_expires_at = null, updated_at = now()
   where id = p_reservation_id;

  update public.lots set status = 'vendido', active_reservation_id = p_reservation_id
   where id = v_res.lot_id;

  perform private.notify(
    v_res.project_id, 'pago_aprobado', 'normal',
    'Reserva convertida en venta',
    format('%s — %s', v_res.tracking_code, v_res.buyer_full_name),
    'reservation', v_res.id,
    jsonb_build_object('tracking_code', v_res.tracking_code),
    p_buyer_email => v_res.buyer_email,
    p_buyer_template => 'buyer_reserva_confirmada');

  perform private.audit('team', v_actor, null, 'reserva.convertida_en_venta', v_res.project_id,
    'reservation', p_reservation_id,
    jsonb_build_object('estado', v_res.status),
    jsonb_build_object('estado', 'confirmada', 'nota', p_note));

  return jsonb_build_object('ok', true, 'tracking_code', v_res.tracking_code);
end;
$fn$;

revoke execute on function public.admin_confirmar_reserva(uuid, text) from public, anon;
grant execute on function public.admin_confirmar_reserva(uuid, text)
  to authenticated, service_role;
