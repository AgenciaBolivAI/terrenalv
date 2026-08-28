-- ACTIVOS, INVENTARIO Y RRHH TAMBIÉN SON DE CONTABILIDAD.
--
-- Ayer se puso el techo del rol sobre Contabilidad y Fiscal: el permiso
-- guardado a mano recorta, no levanta. Faltaban tres secciones que son igual
-- de contables — el registro de activos fijos, el inventario de terrenos y el
-- file del personal con sus sueldos— y en las que un vendedor con el permiso
-- guardado seguía entrando.
--
-- El dueño lo decidió así: a esas tres entran Contabilidad y Administración.
--
-- Y con el mismo cuidado de ayer: `private.is_accounting()` NO se toca. Su
-- nombre engaña —la exigen 49 RPC y la mayoría son del mostrador— y atarla al
-- rol dejaría al vendedor sin poder vender. Lo que se cambia es qué exige cada
-- RPC de estas tres secciones.
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

  -- EL TECHO DEL ROL, antes de mirar el permiso. Los libros —el gerencial, el
  -- fiscal, los activos, el inventario y el file del personal— son de
  -- Contabilidad. Un permiso escrito a mano recorta debajo del techo; nunca lo
  -- levanta.
  if p_seccion in ('contabilidad','fiscal','activos','inventario','rrhh')
     and v_role <> 'contabilidad' then
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

-- La puerta genérica de una sección. Como `assert_contabilidad`: pregunta por
-- la SESIÓN, nunca por `current_user` —dentro de un RPC security definer ese
-- es el dueño de la función y la puerta se abriría sola para todos.
create or replace function private.assert_seccion(p_seccion text)
returns uuid
language plpgsql
stable
set search_path to 'public', 'private'
as $$
begin
  if not private.is_service()
     and private.nivel_de((select auth.uid()), p_seccion) <> 'edita' then
    raise exception 'NO_AUTORIZADO'
      using detail = format('Tu acceso a %s no permite escribir.', p_seccion);
  end if;
  return auth.uid();
end;
$$;

comment on function private.assert_seccion is
  'La puerta de una sección concreta. El rol es el techo (vía nivel_de), así '
  'que un vendedor no entra a activos, inventario ni RRHH ni con el permiso '
  'guardado a mano.';

grant execute on function private.assert_seccion(text) to authenticated;

-- Cada RPC pide su sección.
do $$
declare v_nombre text; v_seccion text; v_def text; r record; v_hubo boolean;
begin
  for v_nombre, v_seccion in
    select * from (values
      ('admin_guardar_activo', 'activos'),
      ('admin_dar_de_baja_activo', 'activos'),
      ('admin_depreciar_mes', 'activos'),
      ('admin_guardar_terreno', 'inventario'),
      ('admin_borrar_terreno', 'inventario'),
      ('admin_guardar_empleado', 'rrhh'),
      ('admin_retirar_empleado', 'rrhh'),
      ('admin_armar_planilla', 'rrhh'),
      ('admin_editar_item_planilla', 'rrhh'),
      ('admin_pagar_planilla', 'rrhh'),
      ('admin_guardar_hr_documento', 'rrhh'),
      ('admin_borrar_hr_documento', 'rrhh')
    ) as t(n, s)
  loop
    v_hubo := false;
    for r in
      select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_nombre and p.prokind = 'f'
    loop
      v_def := pg_get_functiondef(r.oid);
      if position('private.assert_accounting()' in v_def) = 0 then
        raise exception 'PARCHE_NO_AGARRA'
          using detail = format('%s ya no pide assert_accounting.', v_nombre);
      end if;
      execute replace(v_def, 'private.assert_accounting()',
                      format('private.assert_seccion(%L)', v_seccion));
      v_hubo := true;
    end loop;
    if not v_hubo then
      raise exception 'FUNCION_NO_ENCONTRADA' using detail = v_nombre;
    end if;
  end loop;
end $$;
