-- La pantalla de tesorería necesita ver el ámbito para poder cambiarlo.
-- Al final de la lista, que es donde se puede agregar una columna sin
-- renombrar las de al lado.
do $$
declare v_def text;
begin
  select pg_get_viewdef('public.v_tesoreria_saldos'::regclass, true) into v_def;
  if position('COALESCE(m.movimientos, 0::bigint) AS movimientos' in v_def) = 0 then
    raise exception 'ANCLA_MOVIMIENTOS_NO_ENCONTRADA';
  end if;
  v_def := replace(v_def,
    'COALESCE(m.movimientos, 0::bigint) AS movimientos',
    'COALESCE(m.movimientos, 0::bigint) AS movimientos,
    t.ambito');
  execute 'create or replace view public.v_tesoreria_saldos as ' || v_def;
  execute 'alter view public.v_tesoreria_saldos set (security_invoker = true)';
end $$;
