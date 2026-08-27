-- chart_of_accounts.kind es TEXT, no un enum: el cast a account_kind que
-- puse no existe y el alta moría. Y de paso, kind valida contra la lista.
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_upsert_account';
  if position('v_kind::account_kind' in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA';
  end if;
  v_def := replace(v_def, 'v_kind::account_kind', 'v_kind');
  v_def := replace(v_def,
    'if v_kind is null then raise exception ''NATURALEZA_REQUERIDA''; end if;',
    'if v_kind is null then raise exception ''NATURALEZA_REQUERIDA''; end if;
  if v_kind not in (''activo'',''pasivo'',''patrimonio'',''ingreso'',''gasto'') then
    raise exception ''NATURALEZA_INVALIDA'';
  end if;');
  execute v_def;
end $$;
