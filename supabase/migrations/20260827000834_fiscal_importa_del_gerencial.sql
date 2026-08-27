-- Cómo el fiscal se sirve del gerencial: importando. Nunca al revés.

-- Importar un movimiento suelto (o volver a importar uno anulado).
create or replace function public.fiscal_importar_uno(
  p_origen text, p_origen_id uuid, p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_actor uuid;
  v_id uuid;
  v_proj uuid;
  v_fecha date;
  v_glosa text;
  v_numero text;
  v_n int := 0;
begin
  v_actor := private.assert_accounting();
  if p_origen not in ('venta','pago','egreso','comprobante') then
    raise exception 'ORIGEN_INVALIDO';
  end if;

  select d.project_id, min(d.fecha), min(d.glosa)
    into v_proj, v_fecha, v_glosa
    from public.v_libro_diario d
   where d.origen = p_origen and d.origen_id = p_origen_id
   group by d.project_id;

  if v_proj is null then
    raise exception 'MOVIMIENTO_NO_ENCONTRADO'
      using detail = 'Ese movimiento no existe en la contabilidad gerencial.';
  end if;

  if exists (select 1 from public.fiscal_comprobantes f
              where f.origen = p_origen and f.origen_id = p_origen_id
                and f.status = 'registrado') then
    raise exception 'YA_DECLARADO'
      using detail = 'Ese movimiento ya está en el libro fiscal.';
  end if;

  v_numero := private.next_fiscal_number(v_proj, v_fecha);

  insert into public.fiscal_comprobantes
    (project_id, numero, fecha, glosa, origen, origen_id, nota, created_by)
  values (v_proj, v_numero, v_fecha, v_glosa, p_origen, p_origen_id,
          nullif(btrim(coalesce(p_nota, '')), ''), v_actor)
  returning id into v_id;

  insert into public.fiscal_lineas (comprobante_id, account_code, debe, haber, glosa, sort_order)
  select v_id, d.cuenta, d.debe, d.haber, d.glosa,
         row_number() over (order by d.debe desc, d.cuenta)
    from public.v_libro_diario d
   where d.origen = p_origen and d.origen_id = p_origen_id;

  get diagnostics v_n = row_count;

  perform private.audit('team', v_actor, null, 'fiscal.importado', v_proj,
    'fiscal_comprobante', v_id, null,
    jsonb_build_object('numero', v_numero, 'origen', p_origen, 'origen_id', p_origen_id,
                       'lineas', v_n));

  return jsonb_build_object('comprobante_id', v_id, 'numero', v_numero, 'lineas', v_n);
end;
$$;

-- Importar un período entero. Por defecto NO trae lo que está a nombre de un
-- tercero: declarar algo ajeno tiene que ser una decisión escrita, no el
-- resultado de apretar un botón sin mirar.
create or replace function public.fiscal_importar(
  p_project_id uuid,
  p_desde date,
  p_hasta date,
  p_incluir_terceros boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_actor uuid;
  r record;
  v_traidos int := 0;
  v_saltados_tercero int := 0;
  v_saltados_excluidos int := 0;
  v_total numeric(14,2) := 0;
begin
  v_actor := private.assert_accounting();
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'RANGO_INVALIDO';
  end if;

  for r in
    select * from public.v_fiscal_pendiente
     where project_id = p_project_id and fecha between p_desde and p_hasta
     order by fecha, comprobante
  loop
    if r.excluido then
      v_saltados_excluidos := v_saltados_excluidos + 1;
      continue;
    end if;
    if r.titular = 'tercero' and not p_incluir_terceros then
      v_saltados_tercero := v_saltados_tercero + 1;
      continue;
    end if;
    perform public.fiscal_importar_uno(r.origen, r.origen_id, 'importación por período');
    v_traidos := v_traidos + 1;
    v_total := v_total + coalesce(r.debe, 0);
  end loop;

  perform private.audit('team', v_actor, null, 'fiscal.importacion', p_project_id,
    'project', p_project_id, null,
    jsonb_build_object('desde', p_desde, 'hasta', p_hasta, 'traidos', v_traidos,
                       'saltados_tercero', v_saltados_tercero,
                       'saltados_excluidos', v_saltados_excluidos,
                       'incluir_terceros', p_incluir_terceros));

  return jsonb_build_object(
    'traidos', v_traidos, 'total', v_total,
    'saltados_tercero', v_saltados_tercero,
    'saltados_excluidos', v_saltados_excluidos);
end;
$$;

-- Dejar algo afuera, con su motivo escrito. Y poder arrepentirse.
create or replace function public.fiscal_excluir(
  p_origen text, p_origen_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid;
begin
  v_actor := private.assert_accounting();
  if btrim(coalesce(p_motivo, '')) = '' then
    raise exception 'MOTIVO_REQUERIDO'
      using detail = 'Dejar algo fuera del libro fiscal se explica por escrito.';
  end if;
  insert into public.fiscal_exclusiones (origen, origen_id, motivo, created_by)
  values (p_origen, p_origen_id, btrim(p_motivo), v_actor)
  on conflict (origen, origen_id)
  do update set motivo = excluded.motivo, created_by = excluded.created_by,
                created_at = now();
  perform private.audit('team', v_actor, null, 'fiscal.excluido', null,
    'movimiento', p_origen_id, null,
    jsonb_build_object('origen', p_origen, 'motivo', btrim(p_motivo)));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.fiscal_incluir(p_origen text, p_origen_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid;
begin
  v_actor := private.assert_accounting();
  delete from public.fiscal_exclusiones where origen = p_origen and origen_id = p_origen_id;
  perform private.audit('team', v_actor, null, 'fiscal.incluido', null,
    'movimiento', p_origen_id, null, jsonb_build_object('origen', p_origen));
  return jsonb_build_object('ok', true);
end;
$$;

-- Un asiento que sólo existe en el libro fiscal: una reclasificación, un
-- ajuste que del otro lado no tiene sentido. Tiene que cuadrar igual.
create or replace function public.fiscal_guardar_comprobante(
  p_project_id uuid, p_fecha date, p_glosa text, p_lines jsonb, p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_actor uuid;
  v_id uuid;
  v_numero text;
  v_line jsonb;
  v_debe numeric(14,2) := 0;
  v_haber numeric(14,2) := 0;
  v_n int := 0;
begin
  v_actor := private.assert_accounting();
  if btrim(coalesce(p_glosa, '')) = '' then raise exception 'GLOSA_REQUIRED'; end if;
  if p_fecha is null then raise exception 'DATE_REQUIRED'; end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_n := v_n + 1;
    if not exists (select 1 from public.chart_of_accounts
                    where code = v_line->>'account_code' and is_active) then
      raise exception 'CUENTA_INVALIDA';
    end if;
    v_debe  := v_debe  + coalesce((v_line->>'debe')::numeric, 0);
    v_haber := v_haber + coalesce((v_line->>'haber')::numeric, 0);
  end loop;

  if v_n < 2 then raise exception 'MINIMO_DOS_LINEAS'; end if;
  if v_debe <= 0 then raise exception 'IMPORTE_CERO'; end if;
  if round(v_debe, 2) <> round(v_haber, 2) then raise exception 'NO_CUADRA'; end if;

  v_numero := private.next_fiscal_number(p_project_id, p_fecha);
  insert into public.fiscal_comprobantes
    (project_id, numero, fecha, glosa, nota, created_by)
  values (p_project_id, v_numero, p_fecha, btrim(p_glosa),
          nullif(btrim(coalesce(p_nota, '')), ''), v_actor)
  returning id into v_id;

  v_n := 0;
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_n := v_n + 1;
    insert into public.fiscal_lineas (comprobante_id, account_code, debe, haber, glosa, sort_order)
    values (v_id, v_line->>'account_code',
            round(coalesce((v_line->>'debe')::numeric, 0), 2),
            round(coalesce((v_line->>'haber')::numeric, 0), 2),
            nullif(btrim(coalesce(v_line->>'glosa', '')), ''), v_n);
  end loop;

  perform private.audit('team', v_actor, null, 'fiscal.comprobante', p_project_id,
    'fiscal_comprobante', v_id, null,
    jsonb_build_object('numero', v_numero, 'debe', v_debe, 'haber', v_haber, 'lineas', v_n));

  return jsonb_build_object('comprobante_id', v_id, 'numero', v_numero,
                            'debe', v_debe, 'haber', v_haber);
end;
$$;

create or replace function public.fiscal_anular_comprobante(p_id uuid, p_nota text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid; v_c public.fiscal_comprobantes%rowtype;
begin
  v_actor := private.assert_accounting();
  if btrim(coalesce(p_nota, '')) = '' then raise exception 'NOTE_REQUIRED'; end if;
  select * into v_c from public.fiscal_comprobantes where id = p_id for update;
  if not found then raise exception 'COMPROBANTE_NO_ENCONTRADO'; end if;
  if v_c.status = 'anulado' then raise exception 'YA_ANULADO'; end if;

  -- No se borra: se anula. Un comprobante anulado deja de sumar y el
  -- movimiento del gerencial vuelve a quedar disponible para importar.
  update public.fiscal_comprobantes
     set status = 'anulado', anulado_note = btrim(p_nota), updated_at = now()
   where id = p_id;

  perform private.audit('team', v_actor, null, 'fiscal.anulado', v_c.project_id,
    'fiscal_comprobante', p_id, jsonb_build_object('numero', v_c.numero),
    jsonb_build_object('nota', btrim(p_nota)));
  return jsonb_build_object('ok', true);
end;
$$;

do $$
declare f text;
begin
  for f in select unnest(array[
    'fiscal_importar_uno(text, uuid, text)',
    'fiscal_importar(uuid, date, date, boolean)',
    'fiscal_excluir(text, uuid, text)',
    'fiscal_incluir(text, uuid)',
    'fiscal_guardar_comprobante(uuid, date, text, jsonb, text)',
    'fiscal_anular_comprobante(uuid, text)'])
  loop
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('revoke execute on function public.%s from anon', f);
  end loop;
end $$;
