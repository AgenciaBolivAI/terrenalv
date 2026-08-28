-- EL FRENO DE INTENTOS NO FRENABA NADA.
--
-- La función anotaba el intento fallido en la bitácora y acto seguido hacía
-- RAISE. El raise revierte la transacción entera —incluida su propia anotación—
-- así que la bitácora quedaba vacía y el contador siempre daba cero: se podían
-- probar carnets sin límite. Es la misma trampa que ya había mordido a las
-- reservas, donde el intento se registra desde afuera por eso mismo.
--
-- La cura: los fallos que hay que CONTAR no se levantan como excepción, se
-- devuelven como resultado. Así la anotación se confirma y el freno existe.
-- Los errores que no se cuentan (sin sesión, sin cuenta) siguen siendo raise.
--
-- De paso: un carnet vacío se colaba hasta private.normalize_ci y volvía como
-- «INVALID_CI», que le decía al atacante que ese código sí existe. Ahora es el
-- mismo NO_COINCIDE que todo lo demás.
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
  v_ci_norm text;
  v_codigo text := upper(btrim(coalesce(p_tracking_code, '')));
begin
  if v_uid is null then raise exception 'NO_SESSION'; end if;
  select * into v_cli from public.customers where id = v_uid;
  if not found then raise exception 'SIN_CUENTA'; end if;

  select count(*) into v_fallidos
    from public.audit_log
   where action = 'compra.reclamo_fallido'
     and actor_id = v_uid
     and occurred_at > now() - interval '1 hour';
  if v_fallidos >= 10 then
    return jsonb_build_object('ok', false, 'error', 'DEMASIADOS_INTENTOS');
  end if;

  -- Un carnet en blanco no llega a normalize_ci: devolvía INVALID_CI, y ese
  -- error distinto delataba que el código existía.
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
    -- Mismo error para «no existe» y para «no coincide»: cualquier diferencia
    -- sirve para averiguar qué códigos son reales.
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

grant execute on function public.reclamar_mi_compra(text, text) to authenticated;
