-- El enum de comprobantes no tiene 'diario': la depreciación es un asiento
-- de AJUSTE, que es el tipo que corresponde y el que ya existe.
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_depreciar_mes';
  if position('''diario''::voucher_kind' in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA';
  end if;
  v_def := replace(v_def, '''diario''::voucher_kind', '''ajuste''::voucher_kind');
  execute v_def;
end $$;
