-- Tres guardianes para lo que se acaba de arreglar, porque nada de esto se
-- nota mirando la pantalla hasta que ya está mal:
--
--   · Un correlativo repetido: citar «el comprobante ING-0001» tiene que
--     identificar UNO. Es el error que había y que nadie vio durante un mes.
--   · Un comprobante descuadrado en el registro: como el registro sale del
--     libro, un descuadre acá es un descuadre del libro.
--   · Un asiento en una cuenta TITULAR: el mayor de la titular mezclaría lo
--     asentado directo con lo de sus hijas y no cuadraría contra nada.
do $$
declare v_def text; v_ancla text; v_nuevo text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'verificar_integridad';

  v_ancla := $ancla$  return query select 'el_equipo_puede_abrir_el_libro'::text, (v_n = 0),
    format('%s función(es) del libro que el equipo no puede ejecutar', v_n);
end;$ancla$;

  if position(v_ancla in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA'
      using detail = 'verificar_integridad no termina como se esperaba.';
  end if;

  v_nuevo := $nuevo$  return query select 'el_equipo_puede_abrir_el_libro'::text, (v_n = 0),
    format('%s función(es) del libro que el equipo no puede ejecutar', v_n);

  -- El correlativo es del LIBRO, no de la urbanización: un número repetido
  -- significa que alguien volvió a numerar por proyecto.
  select count(*) into v_n from (
    select number from public.journal_entries group by number having count(*) > 1
    union all
    select numero from public.expenses where numero is not null
     group by numero having count(*) > 1) t;
  return query select 'correlativo_de_comprobantes_sin_repetidos'::text, (v_n = 0),
    format('%s número(s) de comprobante repetido(s) en el libro', v_n);

  -- El registro de comprobantes sale del diario: si uno no cuadra, el libro
  -- tampoco.
  select count(*) into v_n from public.v_comprobantes where diferencia <> 0;
  return query select 'cada_comprobante_cuadra'::text, (v_n = 0),
    format('%s comprobante(s) con debe distinto del haber', v_n);

  -- Una cuenta con hijas agrupa, no se asienta.
  select count(*) into v_n
    from public.v_libro_diario d
   where exists (select 1 from public.chart_of_accounts h
                  where h.parent_code = d.cuenta and h.is_active);
  return query select 'no_se_asienta_en_cuentas_titulares'::text, (v_n = 0),
    format('%s movimiento(s) asentado(s) en una cuenta que tiene hijas', v_n);
end;$nuevo$;

  execute replace(v_def, v_ancla, v_nuevo);
end $$;
