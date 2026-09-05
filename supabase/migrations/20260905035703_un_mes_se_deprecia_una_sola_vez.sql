-- `admin_depreciar_mes` no preguntaba NADA antes de asentar: calculaba la
-- depreciación del mes y emitía el comprobante. Dos clics en el botón
-- «Contabilizar depreciación» —o dos personas el mismo día— dejaban DOS
-- comprobantes iguales: el gasto del mes duplicado y la depreciación acumulada
-- del activo duplicada, en silencio y sin forma de notarlo salvo leyendo el
-- mayor. Y como `depreciacion_del_mes` calcula desde las fechas del activo y no
-- desde lo ya asentado, la segunda corrida devuelve exactamente lo mismo.
--
-- El candado es estructural, no por texto: en el libro, la cuenta 1290
-- (depreciación acumulada) sólo la acredita este comprobante — la baja de un
-- activo NO pasa por journal_entries, es una rama derivada de libro_base. Así
-- que «ya existe un ajuste automático, vivo, del último día de ese mes, con una
-- línea al haber de 1290» significa exactamente «ese mes ya se depreció».

create or replace function public.admin_depreciar_mes(p_project_id uuid, p_anio integer, p_mes integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $function$
declare
  v_actor uuid;
  v_total numeric(14,2) := 0;
  v_n int := 0;
  v_lines jsonb := '[]'::jsonb;
  v_fecha date;
  r record;
  v_res jsonb;
  v_ya text;
begin
  v_actor := private.assert_seccion('activos');
  if p_mes < 1 or p_mes > 12 then raise exception 'MES_INVALIDO'; end if;
  v_fecha := (make_date(p_anio, p_mes, 1) + interval '1 month - 1 day')::date;

  -- Un mes se deprecia UNA vez.
  select je.number into v_ya
    from public.journal_entries je
    join public.journal_lines jl on jl.entry_id = je.id
   where je.project_id = p_project_id
     and je.kind = 'ajuste'
     and je.status = 'registrado'
     and je.is_automatic
     and je.entry_date = v_fecha
     and jl.account_code = '1290'
     and jl.haber > 0
   limit 1;
  if v_ya is not null then
    raise exception 'MES_YA_DEPRECIADO'
      using detail = format('La depreciación de %s/%s ya está asentada en el comprobante %s. Anulalo si querés rehacerla.',
                            lpad(p_mes::text, 2, '0'), p_anio, v_ya);
  end if;

  for r in select * from public.depreciacion_del_mes(p_project_id, p_anio, p_mes)
            where monto > 0
  loop
    v_total := v_total + r.monto;
    v_n := v_n + 1;
    v_lines := v_lines || jsonb_build_object(
      'account_code', r.cuenta_depreciacion, 'debe', r.monto, 'haber', 0, 'centro_costo_id', r.centro_costo_id,
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
    p_project_id, v_fecha, 'ajuste'::voucher_kind,
    format('Depreciación de %s/%s — %s activo(s)', lpad(p_mes::text,2,'0'), p_anio, v_n),
    v_lines, null, true);

  perform private.audit('team', v_actor, null, 'activo.depreciacion', p_project_id,
    'project', p_project_id, null,
    jsonb_build_object('anio', p_anio, 'mes', p_mes, 'activos', v_n, 'total', v_total,
                       'comprobante', v_res->>'number'));

  return jsonb_build_object('ok', true, 'activos', v_n, 'total', v_total,
                            'comprobante', v_res->>'number', 'entry_id', v_res->>'entry_id');
end;
$function$;

-- Guardián: dos comprobantes de depreciación para el mismo mes y la misma
-- urbanización es doble gasto. Habría cantado el bug de arriba.
create or replace function private.meses_depreciados_dos_veces()
returns table(project_id uuid, fecha date, veces bigint)
language sql
stable
set search_path to 'public', 'private'
as $$
  select je.project_id, je.entry_date, count(*)
    from public.journal_entries je
   where je.kind = 'ajuste' and je.status = 'registrado' and je.is_automatic
     and exists (select 1 from public.journal_lines jl
                  where jl.entry_id = je.id and jl.account_code = '1290' and jl.haber > 0)
   group by je.project_id, je.entry_date
  having count(*) > 1;
$$;

do $$
declare
  v_def text;
  v_ancla text := $ancla$  select count(*) into v_n from private.fiscal_con_puerta_floja();
  return query select 'el_fiscal_no_usa_la_puerta_floja'::text, (v_n = 0),
    format('%s RPC fiscal(es) colgados de is_accounting', v_n);$ancla$;
begin
  v_def := pg_get_functiondef('public.verificar_integridad()'::regprocedure);
  if position(v_ancla in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA: falta el ancla de la puerta fiscal';
  end if;
  execute replace(v_def, v_ancla, v_ancla || $nuevo$

  -- Un mes se deprecia una sola vez por urbanización.
  select count(*) into v_n from private.meses_depreciados_dos_veces();
  return query select 'ningun_mes_depreciado_dos_veces'::text, (v_n = 0),
    format('%s mes(es) con la depreciación asentada más de una vez', v_n);$nuevo$);
end $$;
