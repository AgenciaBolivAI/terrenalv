-- El chequeo anterior agrupaba por coalesce(...) pero el having usaba la
-- columna a secas — Postgres lo rechaza. Se agrupa por la columna.
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'verificar_integridad';

  if position('group by i.plan_id, coalesce(pl.monthly_interest_pct, 0)' in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA';
  end if;

  v_def := replace(v_def,
    'group by i.plan_id, coalesce(pl.monthly_interest_pct, 0)',
    'group by i.plan_id, pl.monthly_interest_pct');

  execute v_def;
end $$;

-- Y se comprueba en el acto que la función corre entera.
select count(*) from public.verificar_integridad() where not ok;
