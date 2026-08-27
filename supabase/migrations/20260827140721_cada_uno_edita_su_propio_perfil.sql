-- Cada uno puede corregir SU nombre y SU teléfono.
--
-- La política profiles_self_update existía, pero authenticated nunca tuvo
-- GRANT UPDATE sobre profiles, así que en los hechos nadie podía tocar su
-- propio perfil. Y menos mal: esa política abarcaba la fila entera, o sea
-- que con el grant puesto un vendedor se habría podido poner role='admin'.
--
-- Se resuelve por función, no por grant: acá se actualizan DOS columnas y
-- ninguna más. El rol, los permisos y el estado activo siguen siendo
-- decisión del administrador, como debe ser.

create or replace function public.actualizar_mi_perfil(
  p_full_name text,
  p_phone text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_uid uuid;
  v_nombre text;
  v_antes public.profiles%rowtype;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'NO_AUTENTICADO'; end if;

  select * into v_antes from public.profiles where id = v_uid and is_active;
  if not found then
    raise exception 'PERFIL_NO_ENCONTRADO'
      using detail = 'Tu cuenta no está activa.';
  end if;

  v_nombre := nullif(btrim(coalesce(p_full_name, '')), '');
  if v_nombre is null then
    raise exception 'NOMBRE_REQUERIDO'
      using detail = 'Escribí tu nombre completo.';
  end if;
  if length(v_nombre) < 3 then
    raise exception 'NOMBRE_REQUERIDO'
      using detail = 'El nombre es muy corto.';
  end if;

  update public.profiles
     set full_name = v_nombre,
         phone = nullif(btrim(coalesce(p_phone, '')), ''),
         updated_at = now()
   where id = v_uid;

  perform private.audit('team', v_uid, null, 'perfil.propio', null,
    'profile', v_uid,
    jsonb_build_object('nombre', v_antes.full_name, 'telefono', v_antes.phone),
    jsonb_build_object('nombre', v_nombre, 'telefono', nullif(btrim(coalesce(p_phone,'')), '')));

  return jsonb_build_object('ok', true, 'full_name', v_nombre);
end;
$$;

grant execute on function public.actualizar_mi_perfil(text, text) to authenticated;
revoke execute on function public.actualizar_mi_perfil(text, text) from anon;

-- La política de auto-actualización queda sin efecto práctico (no hay grant),
-- pero se saca igual: dejarla escrita invita a que alguien "arregle" el grant
-- algún día y abra la puerta a que un vendedor se ascienda solo.
drop policy if exists profiles_self_update on public.profiles;
