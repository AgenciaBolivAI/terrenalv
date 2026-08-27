-- Misma forma EXACTA que devuelve create_reservation: el cliente guarda ese
-- objeto y pinta la pantalla de pago con él. Un campo de menos y la pantalla
-- de recuperación sale rota justo cuando el comprador ya se asustó una vez.
create or replace function public.recuperar_reserva_del_carnet(
  p_lot_id uuid,
  p_ci text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_res public.reservations%rowtype;
  v_lot public.lots%rowtype;
  v_proj public.projects%rowtype;
  v_pay public.payments%rowtype;
begin
  if p_lot_id is null or btrim(coalesce(p_ci, '')) = '' then return null; end if;

  select r.* into v_res
    from public.reservations r
   where r.lot_id = p_lot_id
     and r.buyer_ci_normalized = private.normalize_ci(p_ci)
     and r.status in ('pendiente_pago', 'en_verificacion', 'rechazo_reintento')
   order by r.created_at desc
   limit 1;
  if not found then return null; end if;

  select * into v_lot  from public.lots     where id = v_res.lot_id;
  select * into v_proj from public.projects where id = v_res.project_id;

  -- El cobro de la seña que create_reservation dejó abierto.
  select * into v_pay from public.payments
   where reservation_id = v_res.id and purpose = 'reserva'
     and status in ('pendiente', 'comprobante_subido', 'rechazado')
   order by created_at desc limit 1;

  return jsonb_build_object(
    'tracking_code', v_res.tracking_code,
    'reservation_id', v_res.id,
    'hold_expires_at', v_res.hold_expires_at,
    'server_now', now(),
    'price_agreed', v_res.price_agreed,
    'currency', v_proj.currency,
    'amount_due', v_pay.amount,
    'amount_due_currency', v_pay.currency,
    'amount_bob', v_pay.amount_bob,
    'exchange_rate', v_pay.exchange_rate_used,
    'reference_code', v_pay.reference_code,
    'payment_instructions', private.get_setting(v_res.project_id, 'payment_instructions')
  );
end;
$$;

grant execute on function public.recuperar_reserva_del_carnet(uuid, text) to anon, authenticated, service_role;
