-- `admin_record_expense` no conocía la forma «planilla», así que devengar una
-- planilla moría con FORMA_DE_PAGO_INVALIDA. Se la agrega donde valida.
do $$
declare v_def text; v_ancla text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_record_expense';

  v_ancla := 'if v_forma not in (''contado'',''credito'',''fondos_por_rendir'') then';
  if position(v_ancla in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA'
      using detail = 'admin_record_expense ya no valida la forma de pago como se esperaba.';
  end if;
  execute replace(v_def, v_ancla,
    'if v_forma not in (''contado'',''credito'',''fondos_por_rendir'',''planilla'') then');
end $$;
