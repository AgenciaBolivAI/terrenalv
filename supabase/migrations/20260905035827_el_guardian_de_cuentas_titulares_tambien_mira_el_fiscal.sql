-- `no_se_asienta_en_cuentas_titulares` sólo miraba `v_libro_diario` — el libro
-- GERENCIAL. El fiscal quedaba fuera, y ahí estaba el problema:
--
--   gerencial (v_libro_diario)        → 0 líneas en cuenta titular
--   fiscal    (v_fiscal_libro_diario) → 1 línea  en cuenta titular
--
-- El comprobante F-2026-00001 declaraba contra '1111', que esta mañana dejó de
-- ser una hoja del plan y pasó a ser cuenta titular cuando la caja comodín se
-- mudó a '1111.00'. El gerencial se reclasificó solo —es derivado—, pero la
-- copia fiscal es una COPIA: se quedó con la cuenta vieja, y el guardián,
-- mirando un solo libro, siguió en verde.
--
-- Ya se rehizo esa declaración (anulada + reimportada como F-2026-00002, ahora
-- contra 1111.00). Acá se ensancha el guardián para que la regla valga en los
-- DOS libros: una cuenta con hijas agrupa, no se asienta — ni acá ni allá.
--
-- (Nombrar v_fiscal_libro_diario desde verificar_integridad está permitido:
-- esa función ya figura en la lista de exentos de private.fiscal_fugas.)

do $$
declare
  v_def text;
  v_viejo text := $v$  select count(*) into v_n
    from public.v_libro_diario d
   where exists (select 1 from public.chart_of_accounts h
                  where h.parent_code = d.cuenta and h.is_active);
  return query select 'no_se_asienta_en_cuentas_titulares'::text, (v_n = 0),
    format('%s movimiento(s) asentado(s) en una cuenta que tiene hijas', v_n);$v$;
  v_nuevo text := $v$  select count(*) into v_n
    from (select d.cuenta from public.v_libro_diario d
           union all
          select f.cuenta from public.v_fiscal_libro_diario f) x
   where exists (select 1 from public.chart_of_accounts h
                  where h.parent_code = x.cuenta and h.is_active);
  return query select 'no_se_asienta_en_cuentas_titulares'::text, (v_n = 0),
    format('%s movimiento(s) (gerencial + fiscal) en una cuenta que tiene hijas', v_n);$v$;
begin
  v_def := pg_get_functiondef('public.verificar_integridad()'::regprocedure);
  if position(v_viejo in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA: el chequeo de cuentas titulares cambió de forma';
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $$;
