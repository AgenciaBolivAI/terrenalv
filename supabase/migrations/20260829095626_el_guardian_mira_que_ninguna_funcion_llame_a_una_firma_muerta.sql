-- Guardián 46. El bug de las tres llamadas colgadas no lo cantó nadie porque
-- plpgsql resuelve las llamadas en tiempo de ejecución: una función puede
-- quedar apuntando a una firma borrada y compilar igual. Este chequeo lo
-- convierte en un rojo de predeploy.

do $$
declare
  v_def text;
  v_ancla text := $ancla$  return query select 'ningun_pago_mayor_a_la_deuda'::text, (v_n = 0),
    format('%s documento(s) con pagos por encima de la deuda', v_n);$ancla$;
  v_nuevo text;
begin
  v_def := pg_get_functiondef('public.verificar_integridad()'::regprocedure);

  if position(v_ancla in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA: no se encontró el ancla en verificar_integridad';
  end if;

  v_nuevo := replace(v_def, v_ancla, v_ancla || $nuevo$

  -- Ninguna función puede llamar a private.next_voucher_number con la firma
  -- vieja de dos argumentos: esa firma se borró cuando el correlativo pasó a
  -- ser del libro entero y no de cada urbanización.
  select private.llamadas_al_correlativo_viejo() into v_n;
  return query select 'nadie_llama_al_correlativo_viejo'::text, (v_n = 0),
    format('%s función(es) llamando a next_voucher_number(project_id, kind)', v_n);$nuevo$);

  execute v_nuevo;
end $$;
