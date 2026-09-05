-- La pantalla necesita poder pasar el carnet cuando la cuenta se creó sin él.
-- Y en cuanto se puede PROBAR un carnet, hay que frenarlo: son siete u ocho
-- dígitos, y quien controle el correo podría probarlos todos hasta acertar.
-- Mismo freno que `reclamar_mi_compra`: se cuentan los intentos fallidos en
-- `audit_log` y a los 10 por hora se corta.
--
-- Se DROPEA antes de crear: cambiar la aridad con `create or replace` no
-- reemplaza, deja las dos firmas conviviendo y la vieja sigue viva.
drop function if exists public.vincular_mis_compras();

create or replace function public.vincular_mis_compras(p_ci text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_cli public.customers%rowtype;
  v_correo text;
  v_ci_norm text;
  v_vinculadas int := 0;
  v_esperando int := 0;
  v_fallidos int;
  v_r record;
begin
  if v_uid is null then raise exception 'NO_SESSION'; end if;
  select * into v_cli from public.customers where id = v_uid;
  if not found then raise exception 'SIN_CUENTA'; end if;

  v_correo := lower(btrim(coalesce(v_cli.email, '')));
  if v_correo = '' then
    return jsonb_build_object('ok', true, 'vinculadas', 0, 'esperando', 0);
  end if;

  select count(*) into v_esperando
    from public.reservations r
   where lower(btrim(coalesce(r.buyer_email, ''))) = v_correo
     and r.customer_id is null;

  -- El carnet ya guardado manda; si no hay, sirve el que acaba de escribir.
  v_ci_norm := v_cli.ci_normalized;
  if v_ci_norm is null and btrim(coalesce(p_ci, '')) <> '' then
    begin
      v_ci_norm := private.normalize_ci(p_ci);
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'CARNET_INVALIDO');
    end;

    -- Probar un carnet cuesta: con freno, como reclamar una compra.
    select count(*) into v_fallidos
      from public.audit_log
     where action = 'compra.enganche_fallido' and actor_id = v_uid
       and occurred_at > now() - interval '1 hour';
    if v_fallidos >= 10 then
      return jsonb_build_object('ok', false, 'error', 'DEMASIADOS_INTENTOS');
    end if;
  end if;

  if v_ci_norm is null then
    return jsonb_build_object('ok', true, 'vinculadas', 0,
                              'esperando', v_esperando, 'falta_carnet', v_esperando > 0);
  end if;

  for v_r in
    select r.id, r.tracking_code, r.project_id
      from public.reservations r
     where lower(btrim(coalesce(r.buyer_email, ''))) = v_correo
       and r.buyer_ci_normalized is not null
       and r.buyer_ci_normalized = v_ci_norm
       and r.customer_id is null
  loop
    update public.reservations set customer_id = v_uid, updated_at = now()
     where id = v_r.id and customer_id is null;
    if found then
      v_vinculadas := v_vinculadas + 1;
      perform private.audit('guest', v_uid, v_cli.full_name, 'compra.vinculada_por_correo',
        v_r.project_id, 'reservation', v_r.id, null,
        jsonb_build_object('tracking_code', v_r.tracking_code, 'correo', v_correo));
    end if;
  end loop;

  -- El carnet recién escrito sólo se guarda si SIRVIÓ para algo. Así un carnet
  -- probado al azar no queda pegado a la cuenta.
  if v_cli.ci_normalized is null then
    if v_vinculadas > 0 then
      update public.customers
         set ci = btrim(p_ci), ci_normalized = v_ci_norm, updated_at = now()
       where id = v_uid;
    elsif btrim(coalesce(p_ci, '')) <> '' then
      perform private.audit('guest', v_uid, v_cli.full_name, 'compra.enganche_fallido',
        null, 'customer', v_uid, null, jsonb_build_object('correo', v_correo));
    end if;
  end if;

  return jsonb_build_object('ok', true, 'vinculadas', v_vinculadas,
                            'esperando', greatest(v_esperando - v_vinculadas, 0),
                            'falta_carnet', v_vinculadas = 0
                                            and v_esperando > 0
                                            and v_cli.ci_normalized is null);
end;
$function$;

grant execute on function public.vincular_mis_compras(text) to authenticated;
