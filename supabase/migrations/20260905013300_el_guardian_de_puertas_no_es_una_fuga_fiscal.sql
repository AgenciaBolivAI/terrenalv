-- `private.puertas_flojas()` nombra las tablas fiscales (tiene que hacerlo:
-- son cinco de las que vigila), y `private.fiscal_fugas()` sale a buscar
-- justamente eso — cualquier función de public/private que mencione un objeto
-- fiscal. Resultado: al ponerlo, el guardián `el_gerencial_no_sabe_del_fiscal`
-- se puso ROJO.
--
-- No es una fuga: la muralla existe para que el libro gerencial no LEA del
-- fiscal, y esto no lee nada — mira pg_policies. Va a la lista de exentos,
-- que es exactamente el mecanismo previsto para los vigilantes (ahí ya están
-- fiscal_fugas y verificar_integridad).

do $$
declare
  v text;
  v_viejo text := $v$'next_fiscal_number','fiscal_fugas','verificar_integridad','rep_fiscal_sumas_y_saldos']$v$;
  v_nuevo text := $v$'next_fiscal_number','fiscal_fugas','verificar_integridad','rep_fiscal_sumas_y_saldos','puertas_flojas']$v$;
begin
  v := pg_get_functiondef('private.fiscal_fugas()'::regprocedure);
  if position(v_viejo in v) = 0 then
    raise exception 'PARCHE_NO_AGARRA: la lista de exentos de fiscal_fugas cambió de forma';
  end if;
  execute replace(v, v_viejo, v_nuevo);
end $$;
