-- El cron `notify_overdue` viene fallando TODOS los días desde el 27/08: nueve
-- corridas, todas con el mismo error —
--   new row for relation "notifications" violates check constraint
--   "notifications_priority_check"
-- porque la función manda prioridad 'media' y el CHECK sólo acepta
-- ('alta','normal','baja'). O sea: desde que se puso, el aviso de cuotas
-- vencidas NUNCA se creó. Nadie se enteró porque nadie mira
-- cron.job_run_details.
--
-- Se corrige el literal (no el CHECK: 'normal' es el vocabulario que usa todo
-- el resto de la app) con el idioma de la casa, exigiendo que el texto viejo
-- esté antes de reemplazarlo.

do $$
declare
  v text;
  v_viejo text := $v$case when r.peor_atraso >= 30 then 'alta' else 'media' end,$v$;
  v_nuevo text := $v$case when r.peor_atraso >= 30 then 'alta' else 'normal' end,$v$;
begin
  v := pg_get_functiondef('private.notify_overdue_installments()'::regprocedure);
  if position(v_viejo in v) = 0 then
    raise exception 'PARCHE_NO_AGARRA: notify_overdue_installments ya no dice media';
  end if;
  execute replace(v, v_viejo, v_nuevo);
end $$;

-- Y que no vuelva a pasar en silencio: un guardián que compara las prioridades
-- que el CÓDIGO usa contra las que el CHECK acepta. Es el mismo error de clase
-- que el correlativo colgado — algo que sólo revienta cuando corre.
create or replace function private.prioridades_invalidas()
returns table(funcion text, prioridad text)
language sql
stable
set search_path to 'public', 'private', 'pg_catalog'
as $$
  with permitidas as (
    select unnest(array['alta','normal','baja']) as p
  ),
  usadas as (
    select n.nspname || '.' || p.proname as funcion,
           (regexp_matches(pg_catalog.pg_get_functiondef(p.oid),
                           $re$private\.notify\s*\([^;]*?'(alta|normal|baja|media|urgente|critica)'$re$,
                           'g'))[1] as prioridad
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public','private') and p.prokind = 'f'
       and p.proname <> 'prioridades_invalidas'
  )
  select u.funcion, u.prioridad
    from usadas u
   where u.prioridad not in (select p from permitidas);
$$;

do $$
declare
  v_def text;
  v_ancla text := $ancla$  select count(*) into v_n from private.puertas_flojas();
  return query select 'la_rls_respeta_el_techo_del_rol'::text, (v_n = 0),
    format('%s política(s) de lectura abiertas a todo el equipo en tablas con techo', v_n);$ancla$;
begin
  v_def := pg_get_functiondef('public.verificar_integridad()'::regprocedure);
  if position(v_ancla in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA: falta el ancla del guardián de puertas';
  end if;
  execute replace(v_def, v_ancla, v_ancla || $nuevo$

  -- Ninguna función avisa con una prioridad que la tabla vaya a rechazar.
  select count(*) into v_n from private.prioridades_invalidas();
  return query select 'los_avisos_usan_prioridades_validas'::text, (v_n = 0),
    format('%s aviso(s) con prioridad fuera de alta/normal/baja', v_n);$nuevo$);
end $$;
