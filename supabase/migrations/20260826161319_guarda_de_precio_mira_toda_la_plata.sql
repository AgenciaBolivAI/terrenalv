-- La guarda del precio miraba `capital_pagado`, que a propósito NO cuenta la
-- seña mientras la reserva no sea venta. Para editar el precio hay que mirar
-- toda la plata que el comprador entregó — seña incluida — o se podría dejar
-- un precio por debajo de lo que ya pagó.
create or replace function public.admin_editar_reserva(
  p_reservation_id uuid,
  p_full_name text default null,
  p_ci text default null,
  p_phone text default null,
  p_email text default null,
  p_price numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid; v_res public.reservations%rowtype; v_antes jsonb; v_correo text;
  v_entregado numeric(14,2);
begin
  v_actor := private.assert_accounting();

  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;

  v_antes := jsonb_build_object(
    'nombre', v_res.buyer_full_name, 'ci', v_res.buyer_ci, 'tel', v_res.buyer_phone,
    'correo', v_res.buyer_email, 'precio', v_res.price_agreed, 'estado', v_res.status);

  if p_full_name is not null and btrim(p_full_name) = '' then
    raise exception 'BUYER_NAME_REQUIRED';
  end if;

  if p_price is not null then
    if p_price <= 0 then raise exception 'INVALID_AMOUNT'; end if;
    -- TODA la plata entregada por este lote: seña, cuotas y abonos.
    select coalesce(sum(x.amount_bob - coalesce(x.interest_bob, 0)), 0) into v_entregado
      from public.payments x
     where x.reservation_id = p_reservation_id and x.status = 'aprobado'
       and x.purpose in ('reserva','cuota','abono');
    if p_price < v_entregado - 0.01 then
      raise exception 'PRECIO_MENOR_A_LO_PAGADO'
        using detail = format('el comprador ya entregó %s', v_entregado);
    end if;
  end if;

  if p_email is not null and btrim(p_email) <> '' then
    v_correo := private.exigir_correo(p_email);
  end if;

  update public.reservations
     set buyer_full_name = coalesce(nullif(btrim(p_full_name), ''), buyer_full_name),
         buyer_ci = coalesce(nullif(btrim(p_ci), ''), buyer_ci),
         buyer_ci_normalized = case when nullif(btrim(p_ci), '') is null
                                    then buyer_ci_normalized
                                    else private.normalize_ci(p_ci) end,
         buyer_phone = case when nullif(btrim(p_phone), '') is null
                            then buyer_phone
                            else private.normalize_phone_bo(p_phone) end,
         buyer_email = case when p_email is null then buyer_email else v_correo end,
         price_agreed = coalesce(p_price, price_agreed),
         updated_at = now()
   where id = p_reservation_id;

  perform private.audit('team', v_actor, null, 'reserva.editada', v_res.project_id,
    'reservation', p_reservation_id, v_antes,
    jsonb_build_object('nombre', p_full_name, 'ci', p_ci, 'tel', p_phone,
                       'correo', p_email, 'precio', p_price));

  return jsonb_build_object('ok', true);
end;
$fn$;
