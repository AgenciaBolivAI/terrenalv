-- v_ventas expone el titular, al final como siempre. La pantalla de Ventas
-- lee la vista con select('*'), así que con esto le llega solo.
do $$
declare
  v_def text;
  v_ancla text := 'COALESCE(pg.intereses, 0::numeric) AS intereses_pagados';
begin
  select pg_get_viewdef('public.v_ventas'::regclass, true) into v_def;
  if position(v_ancla in v_def) = 0 then
    raise exception 'ANCLA_INTERESES_NO_ENCONTRADA';
  end if;

  v_def := replace(v_def, v_ancla, v_ancla || ',
    r.titular,
    r.titular_nombre');

  execute 'create or replace view public.v_ventas as ' || v_def;
  execute 'alter view public.v_ventas set (security_invoker = true)';
end $$;
