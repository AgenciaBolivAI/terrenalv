-- La llamaba `normalizar_ci`, que no existe: la función se llama
-- `private.normalize_ci`. En plpgsql eso no se nota al crear —se resuelve al
-- ejecutar—, así que habría explotado recién en la primera ficha guardada.
-- Es la misma trampa de siempre; abajo se prueba llamándola de verdad.
create or replace function public.admin_guardar_ficha_cliente(
  p_ci text,
  p_direccion text default null,
  p_referencias text default null,
  p_ubicacion text default null,
  p_nota text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $function$
declare
  v_actor uuid;
  v_ci text;
begin
  v_actor := private.assert_seccion('clientes');
  -- La misma llave con la que Clientes agrupa a una persona:
  -- reservations.buyer_ci_normalized.
  v_ci := private.normalize_ci(p_ci);

  insert into public.client_profiles as cp
    (ci_normalized, direccion, referencias, ubicacion, nota, updated_by)
  values
    (v_ci,
     nullif(btrim(coalesce(p_direccion, '')), ''),
     nullif(btrim(coalesce(p_referencias, '')), ''),
     nullif(btrim(coalesce(p_ubicacion, '')), ''),
     nullif(btrim(coalesce(p_nota, '')), ''),
     v_actor)
  on conflict (ci_normalized) do update
     set direccion   = excluded.direccion,
         referencias = excluded.referencias,
         ubicacion   = excluded.ubicacion,
         nota        = excluded.nota,
         updated_by  = v_actor,
         updated_at  = now();

  perform private.audit('team', v_actor, null, 'cliente.ficha_guardada', null,
    'cliente', null, null,
    jsonb_build_object('ci', v_ci, 'con_direccion', p_direccion is not null,
                       'con_ubicacion', p_ubicacion is not null));

  return jsonb_build_object('ok', true, 'ci', v_ci);
end;
$function$;

grant execute on function public.admin_guardar_ficha_cliente(text, text, text, text, text) to authenticated;
