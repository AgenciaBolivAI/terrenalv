-- Reservar un lote desde la oficina.
--
-- /admin/lotes tenía "Vender en oficina" (mark_sold_offline) pero no había
-- forma de dejar un lote RESERVADO desde el panel: el vendedor que cerraba una
-- seña en el mostrador tenía que crear la reserva desde el mapa público
-- haciéndose pasar por el comprador, o dejar el lote como disponible y confiar
-- en que nadie más lo tomara.
--
-- El estado del lote NO se toca a mano por eso mismo: 'reservado' sin una
-- reserva detrás es un lote que nadie puede liberar nunca — sin plazo, sin
-- comprador y sin botón de cancelar. Esta función crea la reserva de verdad,
-- con su plazo y su intención de pago, igual que la del mapa público, y recién
-- entonces mueve el lote.
--
-- Diferencias con la reserva pública (create_reservation):
--   * source = 'oficina', para poder medir cuánto cierra el equipo en persona.
--   * no exige aceptación de términos: la firma es en papel en la oficina.
--   * sin client_meta (no hay navegador del comprador que registrar).
-- Todo lo demás — seña, plazo, código de seguimiento, fila de pago — es igual,
-- así que la reserva se comporta como cualquier otra: vence sola por el cron,
-- se puede extender, cancelar y confirmar con los RPC que ya existen.

create or replace function public.admin_reserve_offline(
  p_lot_id uuid,
  p_full_name text,
  p_ci text,
  p_phone text,
  p_email text default null,
  p_hours int default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_actor uuid;
  v_lot public.lots%rowtype;
  v_project public.projects%rowtype;
  v_mz_code text;
  v_price numeric(12,2);
  v_reserve jsonb;
  v_rate numeric(10,4);
  v_amount_due numeric(12,2);
  v_amount_due_cur text;
  v_amount_bob numeric(12,2);
  v_hold_h int;
  v_expires timestamptz;
  v_code text;
  v_ref text;
  v_res_id uuid;
  v_ci text;
  v_phone text;
  v_try int := 0;
begin
  v_actor := private.assert_admin();

  if btrim(coalesce(p_full_name, '')) = '' then raise exception 'BUYER_NAME_REQUIRED'; end if;
  v_ci := private.normalize_ci(p_ci);
  if coalesce(v_ci, '') = '' then raise exception 'BUYER_CI_REQUIRED'; end if;
  v_phone := private.normalize_phone_bo(p_phone);
  if coalesce(v_phone, '') = '' then raise exception 'BUYER_PHONE_REQUIRED'; end if;

  -- Mover el lote y bloquearlo en un solo paso: dos vendedores reservando el
  -- mismo lote a la vez, el segundo recibe LOT_NOT_AVAILABLE.
  update public.lots
     set status = 'reservado'
   where id = p_lot_id and status = 'disponible' and deleted_at is null
  returning * into v_lot;
  if not found then raise exception 'LOT_NOT_AVAILABLE'; end if;

  select * into v_project from public.projects where id = v_lot.project_id;
  select code into v_mz_code from public.manzanas where id = v_lot.manzana_id;

  v_price := public.lot_price(v_lot.id);
  if v_price is null or v_price <= 0 then raise exception 'LOT_NOT_PRICED'; end if;

  -- Seña, plazo y tipo de cambio: exactamente los mismos ajustes que usa la
  -- reserva pública, para que la oficina y la web nunca coticen distinto.
  v_reserve := coalesce(private.get_setting(v_lot.project_id, 'reserve_amount'),
                        '{"type":"total"}'::jsonb);
  v_rate := coalesce((private.get_setting(v_lot.project_id, 'exchange_rate_bob_per_usd'))::numeric, 6.96);
  if v_reserve->>'type' = 'fijo' then
    v_amount_due := (v_reserve->>'value')::numeric;
    v_amount_due_cur := coalesce(v_reserve->>'currency', 'BOB');
  elsif v_reserve->>'type' = 'porcentaje' then
    v_amount_due := round(v_price * (v_reserve->>'value')::numeric / 100.0, 2);
    v_amount_due_cur := v_project.currency;
  else
    v_amount_due := v_price;
    v_amount_due_cur := v_project.currency;
  end if;
  v_amount_bob := case when v_amount_due_cur = 'BOB' then v_amount_due
                       else round(v_amount_due * v_rate, 2) end;

  v_hold_h := coalesce(p_hours, (private.get_setting(v_lot.project_id, 'hold_hours'))::int, 48);
  if v_hold_h < 1 or v_hold_h > 720 then raise exception 'INVALID_HOLD_HOURS'; end if;
  v_expires := now() + make_interval(hours => v_hold_h);

  loop
    v_try := v_try + 1;
    v_code := private.gen_tracking_code(v_project.tracking_prefix);
    begin
      insert into public.reservations
        (project_id, lot_id, tracking_code, buyer_full_name, buyer_ci, buyer_ci_normalized,
         buyer_phone, buyer_email, status, hold_expires_at, price_agreed, amount_due,
         amount_due_currency, currency, source)
      values
        (v_lot.project_id, v_lot.id, v_code, btrim(p_full_name), p_ci, v_ci,
         v_phone, nullif(btrim(coalesce(p_email, '')), ''), 'pendiente_pago', v_expires,
         v_price, v_amount_due, v_amount_due_cur, v_project.currency, 'oficina')
      returning id into v_res_id;
      exit;
    exception when unique_violation then
      if v_try >= 3 or sqlerrm not like '%tracking_code%' then
        raise;
      end if;
    end;
  end loop;

  update public.lots set active_reservation_id = v_res_id where id = v_lot.id;

  -- Intención de pago, misma transacción: la glosa existe antes de que el
  -- comprador vaya al banco, igual que en la reserva web.
  v_try := 0;
  loop
    v_try := v_try + 1;
    v_ref := v_project.tracking_prefix || '-' || replace(v_mz_code, '-', '') || '-'
             || v_lot.number || '-' || private.gen_code(4);
    begin
      insert into public.payments
        (project_id, reservation_id, provider, reference_code, purpose,
         amount, currency, amount_bob, exchange_rate_used)
      values
        (v_lot.project_id, v_res_id, 'manual_qr', v_ref, 'reserva',
         v_amount_due, v_amount_due_cur, v_amount_bob, v_rate);
      exit;
    exception when unique_violation then
      if v_try >= 3 or sqlerrm not like '%reference_code%' then
        raise;
      end if;
    end;
  end loop;

  perform private.audit('team', v_actor, null, 'lot.reserved_offline', v_lot.project_id,
    'reservation', v_res_id,
    null, jsonb_build_object(
      'lot_id', v_lot.id, 'manzana', v_mz_code, 'lote', v_lot.number,
      'seña', v_amount_due, 'moneda', v_amount_due_cur,
      'vence', v_expires, 'nota', p_note));

  return jsonb_build_object(
    'tracking_code', v_code,
    'reservation_id', v_res_id,
    'amount_due', v_amount_due,
    'amount_due_currency', v_amount_due_cur,
    'hold_expires_at', v_expires,
    'reference_code', v_ref);
end;
$$;

-- Mismo trato que el resto de los RPC de equipo: nunca para anon/public.
revoke execute on function
  public.admin_reserve_offline(uuid, text, text, text, text, int, text)
from public, anon;

grant execute on function
  public.admin_reserve_offline(uuid, text, text, text, text, int, text)
to authenticated, service_role;
