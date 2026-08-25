-- Corrige el orden del traspaso: primero se CIERRA la venta vieja y recién
-- después nace la nueva. El índice único de una-reserva-viva-por-lote rechaza
-- —con razón— dos reservas confirmadas sobre el mismo lote, aunque sea por el
-- instante que dura la transacción. La foto de pagado/saldo se toma antes de
-- cerrar, así que el arrastre no cambia.
create or replace function public.admin_traspasar_venta(
  p_reservation_id uuid,
  p_full_name text,
  p_ci text,
  p_phone text,
  p_email text default null,
  p_note text default null
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

  -- La foto del momento, ANTES de tocar nada: cuánto llevaba pagado y cuánto
  -- quedaba. La misma cuenta que hace v_ventas, para que el arrastre coincida
  -- al centavo con lo que la pantalla venía mostrando.
  select coalesce(sum(x.amount_bob), 0) into v_pagado
    from public.payments x
   where x.reservation_id = p_reservation_id
     and x.status = 'aprobado' and x.purpose <> 'reserva';
  v_base := coalesce((v_vieja.client_meta->'reportado'->>'deuda')::numeric, v_vieja.price_agreed);
  v_saldo := greatest(0, v_base - v_pagado);
  v_pagado := v_pagado + coalesce((v_vieja.client_meta->'reportado'->>'abonado')::numeric, 0);

  -- El plan viejo muere con la venta vieja: sus condiciones eran de ESE
  -- comprador, y dejarlo activo seguiría generando mora a nombre de alguien
  -- que ya no debe nada.
  update public.installment_plans
     set status = 'cancelado', note = coalesce(note || ' · ', '') || 'traspaso', updated_at = now()
   where reservation_id = p_reservation_id and status = 'activo';

  -- PRIMERO se cierra la vieja: el índice de una-reserva-viva-por-lote no
  -- admite dos confirmadas sobre el mismo lote ni por un instante.
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
             'motivo', btrim(p_note))))
      returning id into v_nueva;
      exit;
    exception when unique_violation then
      if v_try >= 3 or sqlerrm not like '%tracking_code%' then raise; end if;
    end;
  end loop;

  -- Y ahora la vieja apunta a la nueva, con el código que ya existe.
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
