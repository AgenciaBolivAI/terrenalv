-- RETIRAR EL AVISO NO BORRA LA HISTORIA.
--
-- El vendedor consigue al comprador POR el mercado —la oficina hasta le pasa
-- las consultas— y el día antes de firmar entra a su página y aprieta «Retirar
-- del mercado»: el aviso pasaba a 'cerrada' sin dejar rastro y el traspaso se
-- hacía sin la comisión del 20 %. Nadie en la oficina tenía cómo notarlo.
--
-- No se le quita el derecho a retirar —es su lote— pero queda escrito: quién,
-- cuándo, con cuántas consultas encima y de qué fecha era la última. Cuando
-- ese mismo lote se traspasa poco después, la oficina lo ve en la auditoría y
-- decide con la información a la vista.
create or replace function public.mercado_retirar(p_tracking_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_res public.reservations%rowtype;
  v_n int;
  v_consultas int;
  v_ultima timestamptz;
  v_precio numeric(12,2);
begin
  select * into v_res from public.reservations
   where tracking_code = upper(btrim(coalesce(p_tracking_code, '')));
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;

  -- Lo que había encima del aviso ANTES de cerrarlo.
  select count(*), max(mi.created_at), max(ml.asking_price_bob)
    into v_consultas, v_ultima, v_precio
    from public.market_listings ml
    left join public.market_inquiries mi on mi.listing_id = ml.id
   where ml.reservation_id = v_res.id and ml.status in ('activa', 'pausada');

  update public.market_listings
     set status = 'cerrada', closed_reason = 'retirada por el vendedor', updated_at = now()
   where reservation_id = v_res.id and status in ('activa','pausada');
  get diagnostics v_n = row_count;

  if v_n > 0 then
    perform private.audit('guest', null, v_res.buyer_full_name, 'mercado.retirado',
      v_res.project_id, 'reservation', v_res.id,
      null,
      jsonb_build_object(
        'tracking_code', v_res.tracking_code,
        'avisos_cerrados', v_n,
        'precio_pedido', v_precio,
        'consultas_recibidas', coalesce(v_consultas, 0),
        'ultima_consulta', v_ultima,
        -- La señal que importa: se retiró con interesados encima y recientes.
        'retirado_con_interes', coalesce(v_consultas, 0) > 0
          and v_ultima > now() - interval '30 days'));
  end if;

  return jsonb_build_object('cerradas', v_n);
end;
$$;
