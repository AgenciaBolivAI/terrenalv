-- 1) EL FRENO SE ESQUIVABA CREANDO CUENTAS.
--
-- El contador miraba los fallos de ESTA cuenta. Registrarse es gratis, así que
-- el atacante hacía diez intentos, creaba otra cuenta y seguía: el techo real
-- era infinito. Ahora hay un segundo freno que no depende de quién intenta —
-- cuenta los fallos contra ESE CÓDIGO, vengan de donde vengan. Veinte fallos
-- en un día y ese contrato no se reclama hasta mañana; la oficina lo vincula a
-- mano, que es un camino que ya existe.
create or replace function public.reclamar_mi_compra(
  p_tracking_code text,
  p_ci text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_res public.reservations%rowtype;
  v_cli public.customers%rowtype;
  v_fallidos int;
  v_por_codigo int;
  v_ci_norm text;
  v_codigo text := upper(btrim(coalesce(p_tracking_code, '')));
begin
  if v_uid is null then raise exception 'NO_SESSION'; end if;
  select * into v_cli from public.customers where id = v_uid;
  if not found then raise exception 'SIN_CUENTA'; end if;

  -- Freno por cuenta.
  select count(*) into v_fallidos
    from public.audit_log
   where action = 'compra.reclamo_fallido' and actor_id = v_uid
     and occurred_at > now() - interval '1 hour';
  if v_fallidos >= 10 then
    return jsonb_build_object('ok', false, 'error', 'DEMASIADOS_INTENTOS');
  end if;

  -- Freno por CÓDIGO: el que de verdad protege al contrato, porque no se
  -- esquiva registrando otra cuenta.
  select count(*) into v_por_codigo
    from public.audit_log
   where action = 'compra.reclamo_fallido'
     and after->>'codigo_probado' = v_codigo
     and occurred_at > now() - interval '24 hours';
  if v_por_codigo >= 20 then
    return jsonb_build_object('ok', false, 'error', 'CONTRATO_BLOQUEADO');
  end if;

  v_ci_norm := case when btrim(coalesce(p_ci, '')) = ''
                    then null else private.normalize_ci(p_ci) end;

  select * into v_res from public.reservations where tracking_code = v_codigo;

  if not found
     or v_ci_norm is null
     or v_res.buyer_ci_normalized is null
     or v_res.buyer_ci_normalized is distinct from v_ci_norm then
    perform private.audit('guest', v_uid, v_cli.full_name, 'compra.reclamo_fallido',
      null, 'reservation', null, null,
      jsonb_build_object('codigo_probado', v_codigo));
    return jsonb_build_object('ok', false, 'error', 'NO_COINCIDE');
  end if;

  if v_res.customer_id is not null and v_res.customer_id <> v_uid then
    return jsonb_build_object('ok', false, 'error', 'YA_RECLAMADA');
  end if;

  update public.reservations set customer_id = v_uid, updated_at = now()
   where id = v_res.id;

  if v_cli.ci_normalized is null then
    update public.customers
       set ci = v_res.buyer_ci, ci_normalized = v_res.buyer_ci_normalized, updated_at = now()
     where id = v_uid;
  end if;

  perform private.audit('guest', v_uid, v_cli.full_name, 'compra.reclamada',
    v_res.project_id, 'reservation', v_res.id, null,
    jsonb_build_object('tracking_code', v_res.tracking_code));

  return jsonb_build_object('ok', true, 'tracking_code', v_res.tracking_code);
end;
$$;

-- 2) LAS CONSULTAS DEL MERCADO LAS LEÍA CUALQUIERA.
--
-- mercado_mis_consultas era SECURITY DEFINER, filtraba solo por el código y
-- estaba concedida a `anon`: con un código —que circula por WhatsApp— se leían
-- el NOMBRE, el TELÉFONO y el mensaje de todos los interesados en ese lote,
-- sin sesión ninguna. Se comprobó contra datos reales.
--
-- Ahora es del dueño de la compra (o del equipo), que es de quien son.
create or replace function public.mercado_mis_consultas(p_tracking_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_res public.reservations%rowtype;
begin
  select * into v_res from public.reservations
   where tracking_code = upper(btrim(coalesce(p_tracking_code, '')));
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;

  if auth.uid() is null then raise exception 'NECESITA_CUENTA'; end if;
  if not private.is_team() and v_res.customer_id is distinct from auth.uid() then
    raise exception 'NO_ES_TU_COMPRA';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'nombre', i.nombre, 'telefono', i.telefono, 'mensaje', i.mensaje,
             'fecha', (i.created_at at time zone 'America/La_Paz')::date)
           order by i.created_at desc)
      from public.market_inquiries i
      join public.market_listings ml on ml.id = i.listing_id
     where ml.reservation_id = v_res.id), '[]'::jsonb);
end;
$$;

revoke execute on function public.mercado_mis_consultas(text) from anon;
grant execute on function public.mercado_mis_consultas(text) to authenticated;
