-- Dos botones para lo mismo, y uno hacía la mitad del trabajo.
--
--   Ventas   → «Anular venta»    → admin_anular_venta   (completo)
--   Reservas → «Revertir venta»  → admin_revert_sale    (a medias)
--
-- admin_revert_sale cancelaba la reserva y liberaba el lote, y ahí se plantaba:
-- el PLAN quedaba 'activo' con sus cuotas 'pendiente' —mora fantasma en el
-- aging, en la proyección y en el aviso diario de vencidas—, la publicación del
-- mercado seguía en la vidriera ofreciendo un lote que ya no era de nadie, y la
-- cadena de traspasos quedaba viva apuntando a una venta cancelada.
--
-- No se arregla duplicando esa lógica: se delega en la buena. Se conserva la
-- aridad para no dejar colgado al llamador (ReservationDetail.tsx:1249), y se
-- traduce NO_ES_VENTA al código que esa pantalla ya sabe explicar.

create or replace function public.admin_revert_sale(p_reservation_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $function$
declare
  v_estado text;
begin
  -- El mensaje que la pantalla de Reservas ya tiene escrito.
  select status::text into v_estado from public.reservations where id = p_reservation_id;
  if v_estado is null then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if v_estado <> 'confirmada' then raise exception 'RESERVATION_NOT_CONFIRMED'; end if;

  -- Una sola implementación: la que también apaga el plan, las cuotas, la
  -- publicación y la cadena de traspasos.
  return public.admin_anular_venta(p_reservation_id, p_note);
end;
$function$;

-- Guardián: ninguna venta cancelada puede dejar atrás un plan activo o cuotas
-- por cobrar. Es el rastro que dejaba el camino a medias.
create or replace function private.planes_vivos_de_ventas_muertas()
returns table(tracking_code text, plan_id uuid, cuotas_vivas bigint)
language sql
stable
set search_path to 'public', 'private'
as $$
  select r.tracking_code, pl.id,
         (select count(*) from public.installments i
           where i.plan_id = pl.id and i.status in ('pendiente','parcial'))
    from public.installment_plans pl
    join public.reservations r on r.id = pl.reservation_id
   where r.status <> 'confirmada'
     and (pl.status = 'activo'
          or exists (select 1 from public.installments i
                      where i.plan_id = pl.id and i.status in ('pendiente','parcial')));
$$;

do $$
declare
  v_def text;
  v_ancla text := $ancla$  select count(*) into v_n from private.saldos_que_no_coinciden();
  return query select 'el_comprador_y_la_oficina_dicen_lo_mismo'::text, (v_n = 0),
    format('%s venta(s) donde el saldo del comprador no es el de la oficina', v_n);$ancla$;
begin
  v_def := pg_get_functiondef('public.verificar_integridad()'::regprocedure);
  if position(v_ancla in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA: falta el ancla del saldo del comprador';
  end if;
  execute replace(v_def, v_ancla, v_ancla || $nuevo$

  -- Una venta que ya no existe no puede seguir cobrando cuotas.
  select count(*) into v_n from private.planes_vivos_de_ventas_muertas();
  return query select 'ninguna_venta_muerta_deja_plan_vivo'::text, (v_n = 0),
    format('%s plan(es) activos o con cuotas vivas sobre ventas no confirmadas', v_n);$nuevo$);
end $$;
