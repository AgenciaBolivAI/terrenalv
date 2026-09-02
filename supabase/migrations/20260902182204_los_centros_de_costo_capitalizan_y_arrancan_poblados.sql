-- Dos deudas de los centros de costo, señaladas por la contadora y por el
-- relevamiento:
--
-- 1. La columna capitaliza existía (una obra que capitaliza manda su egreso al
--    inventario 1151 en vez de a gasto) pero el RPC nació antes que la columna
--    y nunca se recreó: la bandera era INALCANZABLE desde el panel, y la
--    pantalla de Inventario le decía al usuario que la marque «en Gestión»,
--    donde no había nada que marcar.
--
-- 2. La tabla estaba VACÍA, así que «Centro de costos» mostraba «— sin
--    centro —» y nada más. La contadora pidió «las áreas administrativas o
--    urbanizaciones». Se siembran con los nombres reales que ya existen en
--    projects: un centro global (Administración, project_id null: aparece en
--    todos los selects) y uno por urbanización, con su prefijo de siempre.
--    Áreas más finas (Ventas, Obras por etapa…) las nombra ella desde Gestión.

-- 1) La firma vieja se va; la nueva suma p_capitaliza al final, con default,
--    para no romper a ningún llamador con argumentos nombrados.
drop function public.admin_guardar_centro_costo(uuid, uuid, text, text, boolean);

create function public.admin_guardar_centro_costo(
  p_id uuid default null,
  p_project_id uuid default null,
  p_codigo text default null,
  p_nombre text default null,
  p_activo boolean default true,
  p_capitaliza boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $function$
declare
  v_actor uuid;
  v_id uuid;
begin
  v_actor := private.assert_contabilidad();
  if btrim(coalesce(p_codigo, '')) = '' then raise exception 'CODIGO_REQUERIDO'; end if;
  if btrim(coalesce(p_nombre, '')) = '' then raise exception 'NOMBRE_REQUERIDO'; end if;
  if p_project_id is not null
     and not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  if p_id is null then
    insert into public.centros_costo (project_id, codigo, nombre, is_active, capitaliza, created_by)
    values (p_project_id, btrim(p_codigo), btrim(p_nombre), coalesce(p_activo, true),
            coalesce(p_capitaliza, false), v_actor)
    returning id into v_id;
  else
    update public.centros_costo
       set project_id = p_project_id, codigo = btrim(p_codigo), nombre = btrim(p_nombre),
           is_active = coalesce(p_activo, true),
           -- null = «no me lo cambies»: el dialog viejo no mandaba la bandera.
           capitaliza = coalesce(p_capitaliza, capitaliza),
           updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'CENTRO_COSTO_NO_ENCONTRADO'; end if;
  end if;

  perform private.audit('team', v_actor, null, 'centro_costo.guardado', p_project_id,
    'centro_costo', v_id, null,
    jsonb_build_object('codigo', p_codigo, 'nombre', p_nombre, 'activo', p_activo,
                       'capitaliza', p_capitaliza));

  return jsonb_build_object('id', v_id);
end;
$function$;

grant execute on function public.admin_guardar_centro_costo(uuid, uuid, text, text, boolean, boolean) to authenticated;

-- Lección aprendida: cambiar la firma obliga a barrer pg_proc por llamadores
-- de la firma vieja. Acá el único llamador es la pantalla de Gestión.
do $$
declare v_n int;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public','private') and p.prokind = 'f'
     and p.proname <> 'admin_guardar_centro_costo'
     and position('admin_guardar_centro_costo' in pg_get_functiondef(p.oid)) > 0;
  if v_n > 0 then
    raise exception 'HAY_LLAMADORES_COLGADOS: % funcion(es) llaman a admin_guardar_centro_costo', v_n;
  end if;
end $$;

-- 2) La siembra. El trigger de solo-lectura se aparta solo (sin sesión no hay
--    a quién restringir), y el ON CONFLICT respeta lo que la contadora ya
--    hubiera creado con el mismo código.
insert into public.centros_costo (project_id, codigo, nombre, is_active, capitaliza)
values
  (null,                                          'ADM',   'Administración',      true, false),
  ('8f33be64-49dd-4689-9c9e-b6f8a71a472d'::uuid,  'EDS',   'Prados del Sur',      true, false),
  ('10f38049-18cc-44f5-a163-a9a99099f3cd'::uuid,  'ALP',   'Alto Prados del Sur', true, false),
  ('0992d01f-03a2-434b-a94b-fcc133073c48'::uuid,  'LPII',  'Prados del Sur II',   true, false),
  ('7cd76262-c1e3-4972-b4cb-2487bfe1f259'::uuid,  'LPIII', 'Prados del Sur III',  true, false),
  ('8506c361-72b3-41bb-949c-b33e14aff49d'::uuid,  'LPIV',  'Prados del Sur IV',   true, false),
  ('124d3536-3634-4e6d-9697-aa4b9b93b449'::uuid,  'LPV',   'Prados del Sur V',    true, false)
on conflict do nothing;
