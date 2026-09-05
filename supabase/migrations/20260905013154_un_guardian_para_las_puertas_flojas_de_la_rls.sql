-- El agujero del techo del rol no lo cantó nadie porque los 46 guardianes
-- miran la COHERENCIA de los datos, no quién puede leerlos. Éste mira las
-- puertas: si una tabla de las cinco secciones con techo vuelve a quedar con
-- `is_team()` (cualquiera del equipo) o con `is_accounting()` (que honra el
-- permiso escrito a mano), se pone rojo antes del deploy.

create or replace function private.puertas_flojas()
returns table(tabla text, politica text, puerta text)
language sql
stable
set search_path to 'public', 'private'
as $$
  with techo(tabla) as (
    values ('hr_empleados'),('hr_planillas'),('hr_planilla_items'),('hr_documentos'),
           ('fixed_assets'),('asset_categories'),('land_parcels'),
           ('fiscal_comprobantes'),('fiscal_lineas'),('fiscal_exclusiones'),
           ('fiscal_facturas'),('fiscal_parametros'),
           ('journal_entries'),('journal_lines'),('expenses'),('fiscal_periods'),
           ('fondos_a_rendir'),('pagos_a_proveedor')
  )
  select p.tablename::text, p.policyname::text, btrim(p.qual::text)
    from pg_policies p
    join techo t on t.tabla = p.tablename
   where p.schemaname = 'public'
     and p.cmd = 'SELECT'
     and btrim(p.qual::text) in ('private.is_team()', 'private.is_accounting()');
$$;

do $$
declare
  v_def text;
  v_ancla text := $ancla$  select private.llamadas_al_correlativo_viejo() into v_n;
  return query select 'nadie_llama_al_correlativo_viejo'::text, (v_n = 0),
    format('%s función(es) llaman al correlativo con la firma vieja de dos argumentos', v_n);$ancla$;
begin
  v_def := pg_get_functiondef('public.verificar_integridad()'::regprocedure);
  if position(v_ancla in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA: no está el ancla del correlativo en verificar_integridad';
  end if;

  execute replace(v_def, v_ancla, v_ancla || $nuevo$

  -- Las secciones con techo de rol (contabilidad, fiscal, activos, inventario,
  -- rrhh) no pueden quedar con una puerta que abra a todo el equipo.
  select count(*) into v_n from private.puertas_flojas();
  return query select 'la_rls_respeta_el_techo_del_rol'::text, (v_n = 0),
    format('%s política(s) de lectura abiertas a todo el equipo en tablas con techo', v_n);$nuevo$);
end $$;
