-- EL ROL ES EL TECHO.
--
-- El panel dice esto desde siempre, con estas palabras: «El techo lo pone el
-- ROL (la base no deja a un vendedor tocar contabilidad, tenga el permiso que
-- tenga). Los permisos RECORTAN debajo de ese techo». Pero `nivel_de` nunca lo
-- hizo: el permiso escrito a mano se leía ANTES que el rol y lo pisaba entero.
--
-- No era teórico. Beymar es `ventas` y tenía guardado
-- `"contabilidad":"edita"` —alguien le abrió el panel completo—, así que leía
-- los 143 movimientos del libro y podía asentar. El dueño lo dijo claro: a la
-- contabilidad entran contabilidad y admin.
--
-- Ahora el permiso solo RECORTA: puede bajar a un contador de 'edita' a 've' o
-- a 'no', pero no puede subir a un vendedor. Va también sobre `fiscal`, porque
-- el libro fiscal se alimenta del gerencial: cerrar una puerta y dejar la otra
-- abierta no cierra nada.
create or replace function private.nivel_de(p_uid uuid, p_seccion text)
returns text
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_role public.team_role;
  v_permisos jsonb;
  v_nivel text;
begin
  select role, permisos into v_role, v_permisos
    from public.profiles where id = p_uid and is_active;
  if v_role is null then return 'no'; end if;
  if v_role = 'admin' then
    return case when p_seccion = 'analitica' then 'empresa' else 'edita' end;
  end if;

  -- EL TECHO DEL ROL, antes de mirar el permiso: la contabilidad —gerencial y
  -- fiscal— es de contabilidad y del admin. Un permiso escrito a mano recorta
  -- debajo del techo; nunca lo levanta.
  if p_seccion in ('contabilidad', 'fiscal') and v_role <> 'contabilidad' then
    return 'no';
  end if;

  v_nivel := v_permisos ->> p_seccion;
  if v_nivel is not null then return v_nivel; end if;

  -- Sin permiso guardado: lo que cada rol ve hoy, ni más ni menos.
  if p_seccion = 'planes' then
    return case when v_role = 'contabilidad' then 'edita' else 've' end;
  end if;
  if p_seccion = 'analitica' then
    return case when v_role = 'contabilidad' then 'empresa' else 'propia' end;
  end if;
  if p_seccion in ('mapa','proyectos','equipo','configuracion','auditoria') then
    return 'no';  -- hoy son solo-admin
  end if;
  if p_seccion in ('contabilidad','fiscal','inventario','activos','rrhh','comisiones','financiamiento') then
    return case when v_role = 'contabilidad' then 'edita' else 'no' end;
  end if;
  return 'edita';  -- panel, reservas, ventas, clientes, notificaciones,
                   -- mi-cuenta, mercado, traspasos, lotes
end;
$$;

-- Y que ESCRIBIR en la contabilidad use exactamente la misma regla que verla,
-- en vez de tener su propia copia que decía otra cosa (esa copia era la que
-- dejaba asentar a Beymar).
create or replace function private.is_accounting()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select private.nivel_de((select auth.uid()), 'contabilidad') = 'edita';
$$;

comment on function private.is_accounting is
  'Quién puede TOCAR la contabilidad. Sale de nivel_de, igual que lo que '
  'decide si la sección aparece y que private.ve_contabilidad(): una sola '
  'regla, tres usos. El rol es el techo — un vendedor no entra aunque tenga '
  'el permiso guardado.';
