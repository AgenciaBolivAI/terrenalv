-- RECLAMAR UNA COMPRA PIDE DOS COSAS, NO UNA.
--
-- Con solo el código de seguimiento, cualquiera que tenga un código viejo
-- —quedaron en WhatsApp, en recibos impresos, en capturas— se apropia de la
-- compra de otro: vería su nombre, su carnet, su teléfono, sus pagos y su
-- saldo, y podría publicar su lote en el mercado. Las 21 ventas confirmadas
-- están hoy sin reclamar, así que el blanco es todo el padrón.
--
-- Ahora hacen falta el código Y el carnet del comprador. Las dos cosas juntas
-- las tiene el dueño y casi nadie más; el código solo, cualquiera. Las 21
-- ventas tienen carnet cargado, así que ninguna queda sin poder reclamarse.
--
-- Y se limita el ensayo: 10 intentos fallidos por cuenta cada hora. Sin eso se
-- podrían probar carnets contra un código conocido, que es el ataque barato.
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
begin
  if v_uid is null then raise exception 'NO_SESSION'; end if;
  select * into v_cli from public.customers where id = v_uid;
  if not found then raise exception 'SIN_CUENTA'; end if;

  -- El ensayo y error se corta acá: 10 fallos por hora y esta cuenta espera.
  select count(*) into v_fallidos
    from public.audit_log
   where action = 'compra.reclamo_fallido'
     and actor_id = v_uid
     and created_at > now() - interval '1 hour';
  if v_fallidos >= 10 then
    raise exception 'DEMASIADOS_INTENTOS'
      using detail = 'Esperá una hora o escribinos por WhatsApp y lo vinculamos nosotros.';
  end if;

  select * into v_res from public.reservations
   where tracking_code = upper(btrim(coalesce(p_tracking_code, '')));

  -- El carnet tiene que coincidir con el del contrato. Un código sin carnet
  -- —o con el carnet equivocado— no alcanza para quedarse con la compra.
  if not found
     or v_res.buyer_ci_normalized is null
     or v_res.buyer_ci_normalized is distinct from private.normalize_ci(coalesce(p_ci, '')) then
    perform private.audit('guest', v_uid, v_cli.full_name, 'compra.reclamo_fallido',
      null, 'reservation', null, null,
      jsonb_build_object('codigo_probado', upper(btrim(coalesce(p_tracking_code, '')))));
    -- El mismo error para «no existe» y para «no coincide»: si fueran
    -- distintos, se podría usar para averiguar qué códigos existen.
    raise exception 'NO_COINCIDE'
      using detail = 'Revisá el código y el carnet: tienen que ser los del contrato.';
  end if;

  if v_res.customer_id is not null and v_res.customer_id <> v_uid then
    raise exception 'YA_RECLAMADA'
      using detail = 'Esta compra ya está en la cuenta de otra persona. Si es un error, escribinos.';
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

-- La firma vieja de un solo argumento se retira: dejarla viva sería dejar
-- abierta la puerta que esta migración viene a cerrar.
drop function if exists public.reclamar_mi_compra(text);

grant execute on function public.reclamar_mi_compra(text, text) to authenticated;
