-- El orden vuelve a ser el correcto: la venta vieja se cierra ANTES de crear
-- la nueva (el índice de una-reserva-viva-por-lote no permite dos), y el
-- enlace hacia adelante se estampa después, cuando el código nuevo ya existe.
-- La foto de pagado/saldo se toma antes de cerrar, así que no cambia nada.
create or replace function public.admin_traspasar_venta(
  p_reservation_id uuid,
  p_full_name text,
  p_ci text,
  p_phone text,
  p_email text default null,
  p_note text default null,
  p_precio_mercado numeric default null,
  p_medio text default null,
  p_treasury_account_id uuid default null
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
  v_ml public.market_listings%rowtype;
  v_email text;
  v_pagado numeric(14,2);
  v_saldo numeric(14,2);
  v_precio numeric(14,2);
  v_fee numeric(14,2) := 0;
  v_fee_pay uuid;
  v_ref text;
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
  if p_medio is not null and p_medio not in ('efectivo','manual_qr','banco_ganadero','bnb') then
    raise exception 'INVALID_PROVIDER';
  end if;

  select * into v_vieja from public.reservations where id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if v_vieja.status <> 'confirmada' then raise exception 'NO_ES_VENTA'; end if;

  select * into v_project from public.projects where id = v_vieja.project_id;

  select * into v_ml from public.market_listings
   where reservation_id = p_reservation_id and status in ('activa','pausada')
   order by created_at desc limit 1
   for update;
  if found then
    v_precio := round(coalesce(p_precio_mercado, v_ml.asking_price_bob), 2);
    if v_precio is null or v_precio <= 0 then raise exception 'INVALID_AMOUNT'; end if;
    v_fee := round(v_precio * v_ml.fee_pct / 100.0, 2);
  end if;

  -- La foto del momento, ANTES de cerrar nada. Solo cuotas y abonos pagan
  -- lote: ni señas ni comisiones entran acá.
  select coalesce(sum(x.amount_bob), 0) into v_pagado
    from public.payments x
   where x.reservation_id = p_reservation_id
     and x.status = 'aprobado' and x.purpose in ('cuota','abono');
  v_saldo := greatest(0,
    coalesce((v_vieja.client_meta->'reportado'->>'deuda')::numeric, v_vieja.price_agreed)
    - v_pagado);
  v_pagado := v_pagado + coalesce((v_vieja.client_meta->'reportado'->>'abonado')::numeric, 0);

  update public.installment_plans
     set status = 'cancelado', note = coalesce(note || ' · ', '') || 'traspaso', updated_at = now()
   where reservation_id = p_reservation_id and status = 'activo';

  -- Primero se cierra la vieja: el índice de una-reserva-viva-por-lote no
  -- deja nacer la nueva mientras la vieja siga confirmada.
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
             'motivo', btrim(p_note))
           || case when v_ml.id is not null
                then jsonb_build_object('mercado', jsonb_build_object(
                       'listing_id', v_ml.id, 'precio', v_precio,
                       'comision_pct', v_ml.fee_pct, 'comision_bob', v_fee))
                else '{}'::jsonb end))
      returning id into v_nueva;
      exit;
    exception when unique_violation then
      if v_try >= 3 or sqlerrm not like '%tracking_code%' then raise; end if;
    end;
  end loop;

  -- Ahora sí: la vieja apunta a la nueva.
  update public.reservations
     set cancel_reason = 'Traspaso a ' || v_code || ' — ' || btrim(p_note),
         client_meta = coalesce(client_meta, '{}'::jsonb)
           || jsonb_build_object('traspasada_a', jsonb_build_object(
                'reservation', v_nueva, 'tracking', v_code,
                'comprador', btrim(p_full_name), 'fecha', now())),
         updated_at = now()
   where id = p_reservation_id;

  update public.lots
     set status = 'vendido', active_reservation_id = v_nueva
   where id = v_vieja.lot_id;

  -- La comisión: un pago de verdad, del VENDEDOR (la venta vieja), con recibo.
  if v_ml.id is not null then
    if v_fee > 0 then
      v_try := 0;
      loop
        v_try := v_try + 1;
        v_ref := v_project.tracking_prefix || '-MERC-' || private.gen_code(4);
        begin
          insert into public.payments
            (project_id, reservation_id, provider, reference_code, purpose, amount, currency,
             amount_bob, status, verified_by, verified_at, rejection_note, treasury_account_id)
          values
            (v_vieja.project_id, p_reservation_id,
             coalesce(p_medio, 'efectivo')::public.payment_provider_kind, v_ref, 'comision',
             v_fee, 'BOB', v_fee, 'aprobado', v_actor, now(),
             'Comisión ' || v_ml.fee_pct || '% por venta en el mercado — traspaso a ' || v_code,
             p_treasury_account_id)
          returning id into v_fee_pay;
          exit;
        exception when unique_violation then
          if v_try >= 3 then raise; end if;
        end;
      end loop;
    end if;

    update public.market_listings
       set status = 'cerrada',
           closed_reason = 'vendido por el mercado — traspaso a ' || v_code,
           sale_price_bob = v_precio, fee_bob = v_fee, fee_payment_id = v_fee_pay,
           updated_at = now()
     where id = v_ml.id;
  end if;

  perform private.audit('team', v_actor, null, 'venta.traspasada', v_vieja.project_id,
    'reservation', p_reservation_id,
    jsonb_build_object('comprador', v_vieja.buyer_full_name, 'tracking', v_vieja.tracking_code),
    jsonb_build_object('a', btrim(p_full_name), 'tracking_nuevo', v_code,
                       'pagado_arrastrado', v_pagado, 'saldo_arrastrado', v_saldo,
                       'motivo', btrim(p_note),
                       'mercado', v_ml.id is not null,
                       'precio_mercado', v_precio, 'comision_bob', v_fee));
  perform private.audit('team', v_actor, null, 'venta.recibida_traspaso', v_vieja.project_id,
    'reservation', v_nueva, null,
    jsonb_build_object('de', v_vieja.buyer_full_name, 'tracking_anterior', v_vieja.tracking_code));

  return jsonb_build_object(
    'reservation_id', v_nueva, 'tracking_code', v_code,
    'pagado_arrastrado', v_pagado, 'saldo_arrastrado', v_saldo,
    'mercado', v_ml.id is not null,
    'precio_mercado', v_precio, 'comision_bob', v_fee,
    'comision_payment_id', v_fee_pay);
end;
$fn$;
