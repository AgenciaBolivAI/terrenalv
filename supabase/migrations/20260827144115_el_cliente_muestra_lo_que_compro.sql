-- Sin el valor acordado, la fila de un cliente no se puede revisar: se ve lo
-- que pagó y lo que debe, pero no contra qué. Con el precio a la vista la
-- cuenta se cierra sola — comprado menos pagado tiene que dar el saldo, y si
-- no da, hay algo que mirar.
--
-- Va al final, como siempre: create or replace no deja meter una columna en
-- el medio.
do $$
declare
  v_def text;
begin
  select pg_get_viewdef('public.v_clientes'::regclass, true) into v_def;

  -- 1) La lateral que ya trae el saldo de v_ventas trae también el precio.
  if position('SELECT sum(v.saldo) AS saldo,' in v_def) = 0 then
    raise exception 'ANCLA_LATERAL_VENTAS_NO_ENCONTRADA';
  end if;
  v_def := replace(v_def,
    'SELECT sum(v.saldo) AS saldo,',
    'SELECT sum(v.saldo) AS saldo, sum(v.price_agreed) AS comprado,');

  -- 2) La columna nueva, al final del SELECT.
  if position('string_agg(DISTINCT btrim(b.buyer_full_name), '' · ''::text) AS nombres_vistos' in v_def) = 0 then
    raise exception 'ANCLA_NOMBRES_NO_ENCONTRADA';
  end if;
  v_def := replace(v_def,
    'string_agg(DISTINCT btrim(b.buyer_full_name), '' · ''::text) AS nombres_vistos',
    'string_agg(DISTINCT btrim(b.buyer_full_name), '' · ''::text) AS nombres_vistos,
    COALESCE(vv.comprado, 0::numeric) AS comprado_total');

  -- 3) Y al GROUP BY, porque sale de la lateral.
  if position('vv.saldo, vv.con_plan' in v_def) = 0 then
    raise exception 'ANCLA_GROUP_BY_NO_ENCONTRADA';
  end if;
  v_def := replace(v_def, 'vv.saldo, vv.con_plan', 'vv.saldo, vv.comprado, vv.con_plan');

  execute 'create or replace view public.v_clientes as ' || v_def;
  execute 'alter view public.v_clientes set (security_invoker = true)';
end $$;

-- ¿Cuadra? comprado − pagado tiene que dar el saldo en cada cliente que ya
-- compró. Los que sólo reservaron todavía no tienen valor acordado.
select count(*) filter (where lotes_comprados > 0) as clientes_con_compra,
       count(*) filter (where lotes_comprados > 0
                          and round(comprado_total - pagado_total, 2) <> round(saldo_total, 2))
         as filas_que_no_cuadran
  from public.v_clientes;
