-- «detalle» es también el nombre de la columna que devuelve
-- verificar_integridad, así que adentro hay que decir de cuál se habla.
do $$
declare v_def text; v_viejo text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'verificar_integridad';

  v_viejo :=
'    coalesce((select string_agg(objeto || '': '' || detalle, ''; '')
                from private.fiscal_fugas()),';

  if position(v_viejo in v_def) = 0 then
    raise exception 'PARCHE_FUGAS_NO_AGARRA';
  end if;

  v_def := replace(v_def, v_viejo,
'    coalesce((select string_agg(f.objeto || '': '' || f.detalle, ''; '')
                from private.fiscal_fugas() f),');

  execute v_def;
end $$;

select count(*) from public.verificar_integridad();
