-- Alta y baja de terrenos madre y de activos fijos, más el asiento mensual
-- de depreciación.

create or replace function public.admin_guardar_terreno(
  p_id uuid default null,
  p_project_id uuid default null,
  p_codigo text default null,
  p_nombre text default null,
  p_superficie_m2 numeric default null,
  p_costo_compra numeric default null,
  p_fecha_compra date default null,
  p_vendedor_contact_id uuid default null,
  p_vendedor_nombre text default null,
  p_documento text default null,
  p_costo_m2_presupuestado numeric default null,
  p_treasury_account_id uuid default null,
  p_titular text default 'empresa',
  p_titular_nombre text default null,
  p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid; v_id uuid; v_titular text; v_nombre text;
begin
  v_actor := private.assert_accounting();
  if btrim(coalesce(p_codigo,'')) = '' then raise exception 'CODIGO_REQUERIDO'; end if;
  if btrim(coalesce(p_nombre,'')) = '' then raise exception 'NOMBRE_REQUERIDO'; end if;
  if p_superficie_m2 is null or p_superficie_m2 <= 0 then raise exception 'SUPERFICIE_INVALIDA'; end if;
  if p_costo_compra is null or p_costo_compra < 0 then raise exception 'COSTO_INVALIDO'; end if;
  if p_fecha_compra is null then raise exception 'FECHA_REQUERIDA'; end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'PROJECT_NOT_FOUND';
  end if;
  perform private.assert_periodo_abierto(p_project_id, p_fecha_compra);

  v_titular := coalesce(nullif(btrim(coalesce(p_titular,'')),''), 'empresa');
  if v_titular not in ('empresa','tercero') then raise exception 'TITULAR_INVALIDO'; end if;
  v_nombre := nullif(btrim(coalesce(p_titular_nombre,'')),'');
  if v_titular = 'tercero' and v_nombre is null then
    raise exception 'TITULAR_SIN_NOMBRE'
      using detail = 'Si el terreno está a nombre de un tercero, hay que decir de quién.';
  end if;
  if v_titular = 'empresa' then v_nombre := null; end if;

  if p_id is null then
    insert into public.land_parcels
      (project_id, codigo, nombre, superficie_m2, costo_compra, fecha_compra,
       vendedor_contact_id, vendedor_nombre, documento, costo_m2_presupuestado,
       treasury_account_id, titular, titular_nombre, nota, created_by)
    values (p_project_id, btrim(p_codigo), btrim(p_nombre), p_superficie_m2, p_costo_compra,
       p_fecha_compra, p_vendedor_contact_id, nullif(btrim(coalesce(p_vendedor_nombre,'')),''),
       nullif(btrim(coalesce(p_documento,'')),''), p_costo_m2_presupuestado,
       p_treasury_account_id, v_titular, v_nombre, nullif(btrim(coalesce(p_nota,'')),''), v_actor)
    returning id into v_id;
  else
    update public.land_parcels
       set project_id = p_project_id, codigo = btrim(p_codigo), nombre = btrim(p_nombre),
           superficie_m2 = p_superficie_m2, costo_compra = p_costo_compra,
           fecha_compra = p_fecha_compra, vendedor_contact_id = p_vendedor_contact_id,
           vendedor_nombre = nullif(btrim(coalesce(p_vendedor_nombre,'')),''),
           documento = nullif(btrim(coalesce(p_documento,'')),''),
           costo_m2_presupuestado = p_costo_m2_presupuestado,
           treasury_account_id = p_treasury_account_id,
           titular = v_titular, titular_nombre = v_nombre,
           nota = nullif(btrim(coalesce(p_nota,'')),''), updated_at = now()
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'TERRENO_NO_ENCONTRADO'; end if;
  end if;

  perform private.audit('team', v_actor, null, 'terreno.guardado', p_project_id,
    'land_parcel', v_id, null,
    jsonb_build_object('codigo', p_codigo, 'superficie', p_superficie_m2,
                       'costo', p_costo_compra, 'fecha', p_fecha_compra));
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.admin_borrar_terreno(p_id uuid, p_nota text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid; v_p public.land_parcels%rowtype;
begin
  v_actor := private.assert_accounting();
  if btrim(coalesce(p_nota,'')) = '' then raise exception 'NOTE_REQUIRED'; end if;
  select * into v_p from public.land_parcels where id = p_id;
  if not found then raise exception 'TERRENO_NO_ENCONTRADO'; end if;
  perform private.assert_periodo_abierto(v_p.project_id, v_p.fecha_compra);
  delete from public.land_parcels where id = p_id;
  perform private.audit('team', v_actor, null, 'terreno.borrado', v_p.project_id,
    'land_parcel', p_id, jsonb_build_object('codigo', v_p.codigo, 'costo', v_p.costo_compra),
    jsonb_build_object('nota', btrim(p_nota)));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------- activos fijos ---------------------------------------------------
create or replace function public.admin_guardar_activo(
  p_id uuid default null,
  p_project_id uuid default null,
  p_categoria_id uuid default null,
  p_codigo text default null,
  p_nombre text default null,
  p_descripcion text default null,
  p_identificacion text default null,
  p_fecha_compra date default null,
  p_fecha_alta date default null,
  p_costo numeric default null,
  p_valor_residual numeric default 0,
  p_vida_util_meses int default null,
  p_centro_costo_id uuid default null,
  p_proveedor_contact_id uuid default null,
  p_expense_id uuid default null,
  p_titular text default 'empresa',
  p_titular_nombre text default null,
  p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid; v_id uuid; v_vida int; v_titular text; v_nombre text;
begin
  v_actor := private.assert_accounting();
  if btrim(coalesce(p_codigo,'')) = '' then raise exception 'CODIGO_REQUERIDO'; end if;
  if btrim(coalesce(p_nombre,'')) = '' then raise exception 'NOMBRE_REQUERIDO'; end if;
  if p_costo is null or p_costo <= 0 then raise exception 'COSTO_INVALIDO'; end if;
  if coalesce(p_valor_residual,0) < 0 or coalesce(p_valor_residual,0) >= p_costo then
    raise exception 'RESIDUAL_INVALIDO'
      using detail = 'El valor residual tiene que ser menor al costo.';
  end if;
  if p_fecha_compra is null then raise exception 'FECHA_REQUERIDA'; end if;

  -- La vida útil sale de la categoría salvo que la escriban a mano.
  select vida_util_meses into v_vida from public.asset_categories
   where id = p_categoria_id and is_active;
  if v_vida is null then raise exception 'CATEGORIA_NO_ENCONTRADA'; end if;
  v_vida := coalesce(p_vida_util_meses, v_vida);

  v_titular := coalesce(nullif(btrim(coalesce(p_titular,'')),''), 'empresa');
  if v_titular not in ('empresa','tercero') then raise exception 'TITULAR_INVALIDO'; end if;
  v_nombre := nullif(btrim(coalesce(p_titular_nombre,'')),'');
  if v_titular = 'tercero' and v_nombre is null then raise exception 'TITULAR_SIN_NOMBRE'; end if;
  if v_titular = 'empresa' then v_nombre := null; end if;

  if p_id is null then
    insert into public.fixed_assets
      (project_id, categoria_id, codigo, nombre, descripcion, identificacion,
       fecha_compra, fecha_alta, costo, valor_residual, vida_util_meses,
       centro_costo_id, proveedor_contact_id, expense_id, titular, titular_nombre,
       nota, created_by)
    values (p_project_id, p_categoria_id, btrim(p_codigo), btrim(p_nombre),
       nullif(btrim(coalesce(p_descripcion,'')),''), nullif(btrim(coalesce(p_identificacion,'')),''),
       p_fecha_compra, coalesce(p_fecha_alta, p_fecha_compra), p_costo,
       coalesce(p_valor_residual,0), v_vida, p_centro_costo_id, p_proveedor_contact_id,
       p_expense_id, v_titular, v_nombre, nullif(btrim(coalesce(p_nota,'')),''), v_actor)
    returning id into v_id;
  else
    update public.fixed_assets
       set project_id = p_project_id, categoria_id = p_categoria_id, codigo = btrim(p_codigo),
           nombre = btrim(p_nombre), descripcion = nullif(btrim(coalesce(p_descripcion,'')),''),
           identificacion = nullif(btrim(coalesce(p_identificacion,'')),''),
           fecha_compra = p_fecha_compra, fecha_alta = coalesce(p_fecha_alta, p_fecha_compra),
           costo = p_costo, valor_residual = coalesce(p_valor_residual,0),
           vida_util_meses = v_vida, centro_costo_id = p_centro_costo_id,
           proveedor_contact_id = p_proveedor_contact_id,
           titular = v_titular, titular_nombre = v_nombre,
           nota = nullif(btrim(coalesce(p_nota,'')),''), updated_at = now()
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'ACTIVO_NO_ENCONTRADO'; end if;
  end if;

  perform private.audit('team', v_actor, null, 'activo.guardado', p_project_id,
    'fixed_asset', v_id, null,
    jsonb_build_object('codigo', p_codigo, 'costo', p_costo, 'vida_meses', v_vida));
  return jsonb_build_object('id', v_id, 'vida_util_meses', v_vida);
end;
$$;

create or replace function public.admin_dar_de_baja_activo(
  p_id uuid, p_fecha date, p_motivo text, p_valor_venta numeric default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid; v_a public.fixed_assets%rowtype;
begin
  v_actor := private.assert_accounting();
  if btrim(coalesce(p_motivo,'')) = '' then raise exception 'NOTE_REQUIRED'; end if;
  select * into v_a from public.fixed_assets where id = p_id for update;
  if not found then raise exception 'ACTIVO_NO_ENCONTRADO'; end if;
  if v_a.estado <> 'activo' then raise exception 'YA_DADO_DE_BAJA'; end if;
  if coalesce(p_fecha, current_date) < v_a.fecha_alta then
    raise exception 'FECHA_INVALIDA'
      using detail = 'No se puede dar de baja antes de darlo de alta.';
  end if;

  update public.fixed_assets
     set estado = case when coalesce(p_valor_venta,0) > 0 then 'vendido' else 'dado_de_baja' end,
         fecha_baja = coalesce(p_fecha, current_date),
         motivo_baja = btrim(p_motivo),
         valor_venta = p_valor_venta,
         updated_at = now()
   where id = p_id;

  perform private.audit('team', v_actor, null, 'activo.baja', v_a.project_id,
    'fixed_asset', p_id, jsonb_build_object('codigo', v_a.codigo),
    jsonb_build_object('fecha', p_fecha, 'motivo', btrim(p_motivo), 'venta', p_valor_venta));
  return jsonb_build_object('ok', true);
end;
$$;

-- El asiento mensual de depreciación, calculado y contabilizado de una.
create or replace function public.admin_depreciar_mes(
  p_project_id uuid, p_anio int, p_mes int)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_actor uuid;
  v_total numeric(14,2) := 0;
  v_n int := 0;
  v_lines jsonb := '[]'::jsonb;
  v_fecha date;
  r record;
  v_res jsonb;
begin
  v_actor := private.assert_accounting();
  if p_mes < 1 or p_mes > 12 then raise exception 'MES_INVALIDO'; end if;
  v_fecha := (make_date(p_anio, p_mes, 1) + interval '1 month - 1 day')::date;

  for r in select * from public.depreciacion_del_mes(p_project_id, p_anio, p_mes)
            where monto > 0
  loop
    v_total := v_total + r.monto;
    v_n := v_n + 1;
    v_lines := v_lines || jsonb_build_object(
      'account_code', r.cuenta_depreciacion, 'debe', r.monto, 'haber', 0,
      'glosa', r.codigo || ' · ' || r.nombre);
  end loop;

  if v_n = 0 then
    raise exception 'NADA_QUE_DEPRECIAR'
      using detail = 'Ningún activo deprecia en ese mes.';
  end if;

  -- La contrapartida, en una sola línea: depreciación acumulada.
  v_lines := v_lines || jsonb_build_object(
    'account_code', '1290', 'debe', 0, 'haber', v_total,
    'glosa', 'Depreciación acumulada del mes');

  v_res := public.admin_save_voucher(
    p_project_id, v_fecha, 'diario'::voucher_kind,
    format('Depreciación de %s/%s — %s activo(s)', lpad(p_mes::text,2,'0'), p_anio, v_n),
    v_lines, null, true);

  perform private.audit('team', v_actor, null, 'activo.depreciacion', p_project_id,
    'project', p_project_id, null,
    jsonb_build_object('anio', p_anio, 'mes', p_mes, 'activos', v_n, 'total', v_total,
                       'comprobante', v_res->>'number'));

  return jsonb_build_object('ok', true, 'activos', v_n, 'total', v_total,
                            'comprobante', v_res->>'number', 'entry_id', v_res->>'entry_id');
end;
$$;

do $$
declare f text;
begin
  for f in select unnest(array[
    'admin_guardar_terreno(uuid, uuid, text, text, numeric, numeric, date, uuid, text, text, numeric, uuid, text, text, text)',
    'admin_borrar_terreno(uuid, text)',
    'admin_guardar_activo(uuid, uuid, uuid, text, text, text, text, date, date, numeric, numeric, int, uuid, uuid, uuid, text, text, text)',
    'admin_dar_de_baja_activo(uuid, date, text, numeric)',
    'admin_depreciar_mes(uuid, int, int)'])
  loop
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('revoke execute on function public.%s from anon', f);
  end loop;
end $$;

-- ---------- las secciones nuevas, en los permisos --------------------------
do $$
declare v_def text; fn text;
begin
  for fn in select unnest(array['nivel_de','mi_acceso','admin_guardar_permisos']) loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where p.proname = fn and n.nspname in ('public','private');
    if position('''contabilidad'',''fiscal''' in v_def) = 0 then
      raise exception 'PARCHE_% NO_AGARRA', fn;
    end if;
    v_def := replace(v_def, '''contabilidad'',''fiscal''',
                            '''contabilidad'',''fiscal'',''inventario'',''activos''');
    execute v_def;
  end loop;
end $$;
