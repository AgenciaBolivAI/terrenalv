-- Políticas 6 y 7: la cantidad de la escala la mueve Gerencia General y el %
-- de cada tramo es atribución del Directorio. Así que la escala se edita
-- desde el panel, no se toca en el código.

create or replace function public.admin_guardar_escala(
  p_id uuid default null,
  p_gestion int default null,
  p_modalidad text default null,
  p_desde int default null,
  p_hasta int default null,
  p_pct_inicial numeric default null,
  p_pct_reintegro numeric default 0,
  p_activo boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_actor uuid;
  v_id uuid;
  v_choque int;
begin
  v_actor := private.assert_admin();

  if p_gestion is null or p_gestion < 2000 or p_gestion > 2100 then
    raise exception 'GESTION_INVALIDA';
  end if;
  if p_modalidad not in ('contado','plazo') then raise exception 'MODALIDAD_INVALIDA'; end if;
  if p_desde is null or p_desde < 1 then raise exception 'RANGO_INVALIDO'; end if;
  if p_hasta is not null and p_hasta < p_desde then raise exception 'RANGO_INVALIDO'; end if;
  if p_pct_inicial is null or p_pct_inicial < 0 then raise exception 'PCT_INVALIDO'; end if;
  if coalesce(p_pct_reintegro, 0) < 0 then raise exception 'PCT_INVALIDO'; end if;
  if p_pct_inicial + coalesce(p_pct_reintegro, 0) > 100 then raise exception 'PCT_INVALIDO'; end if;

  -- Dos tramos que se pisan dejarían el % de un asesor a suerte del plan de
  -- ejecución: la misma cantidad de ventas caería en dos tarifas distintas.
  select count(*) into v_choque
    from public.commission_scales e
   where e.is_active and e.gestion = p_gestion and e.modalidad = p_modalidad
     and (p_id is null or e.id <> p_id)
     and p_desde <= coalesce(e.hasta, 2147483647)
     and coalesce(p_hasta, 2147483647) >= e.desde;
  if v_choque > 0 then
    raise exception 'TRAMOS_SE_PISAN'
      using detail = 'Ese rango de cantidad ya está cubierto por otro tramo de la misma escala.';
  end if;

  if p_id is null then
    insert into public.commission_scales
      (gestion, modalidad, desde, hasta, pct_inicial, pct_reintegro, is_active, created_by)
    values (p_gestion, p_modalidad, p_desde, p_hasta, p_pct_inicial,
            coalesce(p_pct_reintegro, 0), coalesce(p_activo, true), v_actor)
    returning id into v_id;
  else
    update public.commission_scales
       set gestion = p_gestion, modalidad = p_modalidad, desde = p_desde, hasta = p_hasta,
           pct_inicial = p_pct_inicial, pct_reintegro = coalesce(p_pct_reintegro, 0),
           is_active = coalesce(p_activo, true), updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'TRAMO_NO_ENCONTRADO'; end if;
  end if;

  perform private.audit('team', v_actor, null, 'comision.escala', null,
    'commission_scale', v_id, null,
    jsonb_build_object('gestion', p_gestion, 'modalidad', p_modalidad,
                       'desde', p_desde, 'hasta', p_hasta,
                       'pct_inicial', p_pct_inicial, 'pct_reintegro', p_pct_reintegro));

  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.admin_borrar_escala(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid;
begin
  v_actor := private.assert_admin();
  delete from public.commission_scales where id = p_id;
  perform private.audit('team', v_actor, null, 'comision.escala_borrada', null,
    'commission_scale', p_id, null, null);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_guardar_politica_comision(
  p_gestion int,
  p_periodo text default null,
  p_cuota_reintegro int default null,
  p_split_compartida_pct numeric default null,
  p_bono_equipo_mensual numeric default null,
  p_bono_personal_semanal numeric default null,
  p_ventas_objetivo_semanal int default null,
  p_notas text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid;
begin
  v_actor := private.assert_admin();
  if p_periodo is not null and p_periodo not in ('gestion','mes') then
    raise exception 'PERIODO_INVALIDO';
  end if;
  if p_cuota_reintegro is not null and p_cuota_reintegro < 1 then
    raise exception 'CUOTA_INVALIDA';
  end if;

  insert into public.commission_policy as cp (gestion, periodo, cuota_reintegro,
      split_compartida_pct, bono_equipo_mensual, bono_personal_semanal,
      ventas_objetivo_semanal, notas)
  values (p_gestion, coalesce(p_periodo,'gestion'), coalesce(p_cuota_reintegro,4),
          coalesce(p_split_compartida_pct,50), coalesce(p_bono_equipo_mensual,5000),
          coalesce(p_bono_personal_semanal,2000), coalesce(p_ventas_objetivo_semanal,30),
          p_notas)
  on conflict (gestion) do update
     set periodo = coalesce(p_periodo, cp.periodo),
         cuota_reintegro = coalesce(p_cuota_reintegro, cp.cuota_reintegro),
         split_compartida_pct = coalesce(p_split_compartida_pct, cp.split_compartida_pct),
         bono_equipo_mensual = coalesce(p_bono_equipo_mensual, cp.bono_equipo_mensual),
         bono_personal_semanal = coalesce(p_bono_personal_semanal, cp.bono_personal_semanal),
         ventas_objetivo_semanal = coalesce(p_ventas_objetivo_semanal, cp.ventas_objetivo_semanal),
         notas = coalesce(p_notas, cp.notas),
         updated_at = now();

  perform private.audit('team', v_actor, null, 'comision.politica', null,
    'commission_policy', null, null, jsonb_build_object('gestion', p_gestion,
      'periodo', p_periodo, 'cuota_reintegro', p_cuota_reintegro));
  return jsonb_build_object('ok', true);
end;
$$;

do $$
declare f text;
begin
  for f in select unnest(array[
    'admin_guardar_escala(uuid, int, text, int, int, numeric, numeric, boolean)',
    'admin_borrar_escala(uuid)',
    'admin_guardar_politica_comision(int, text, int, numeric, numeric, numeric, int, text)'])
  loop
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('revoke execute on function public.%s from anon', f);
  end loop;
end $$;

-- Guardián: ningún tramo de la escala puede pisarse con otro, y ninguna
-- cantidad puede quedar sin tramo (un asesor sin tarifa cobraría cero).
do $$
declare v_def text; v_ancla text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'verificar_integridad';

  v_ancla :=
'  return query select ''libro_fiscal_cuadra''::text, (v_n = 0),
    format(''%s urbanización(es) descuadrada(s) en el libro fiscal'', v_n);
end;';
  if position(v_ancla in v_def) = 0 then
    raise exception 'PARCHE_ESCALA_NO_AGARRA';
  end if;

  v_def := replace(v_def, v_ancla,
'  return query select ''libro_fiscal_cuadra''::text, (v_n = 0),
    format(''%s urbanización(es) descuadrada(s) en el libro fiscal'', v_n);

  -- Dos tramos que se pisan dejan el % del asesor a suerte del plan de
  -- ejecución. Y un tramo faltante lo deja cobrando cero sin que nadie avise.
  select count(*) into v_n
    from public.commission_scales a
    join public.commission_scales b
      on b.id <> a.id and b.gestion = a.gestion and b.modalidad = a.modalidad
     and b.is_active and a.desde <= coalesce(b.hasta, 2147483647)
     and coalesce(a.hasta, 2147483647) >= b.desde
   where a.is_active;
  return query select ''escala_de_comision_sin_solape''::text, (v_n = 0),
    format(''%s tramo(s) de comisión que se pisan'', v_n);

  select count(*) into v_n from (
    select e.gestion, e.modalidad
      from public.commission_scales e where e.is_active
     group by e.gestion, e.modalidad
    having min(e.desde) <> 1
        or count(*) filter (where e.hasta is null) <> 1) t;
  return query select ''escala_de_comision_completa''::text, (v_n = 0),
    format(''%s escala(s) que no arrancan en 1 o no tienen tramo abierto al final'', v_n);
end;');

  execute v_def;
end $$;

select prueba, ok, detalle from public.verificar_integridad()
 where prueba like 'escala%';
