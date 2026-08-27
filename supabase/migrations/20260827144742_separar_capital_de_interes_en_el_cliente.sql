-- «Pagado» venía en bruto: capital e intereses sumados en el mismo número.
-- Pero el saldo baja SÓLO con capital — el interés es precio del tiempo, no
-- del terreno. Con planes al 0% no se notaba; en cuanto uno cobre interés,
-- la fila deja de cuadrar y nadie sabría por qué.
--
-- Se parte en dos. pagado_total queda como estaba (bruto) para no romper a
-- quien ya lo lee; las dos columnas nuevas van al final.
do $$
declare
  v_def text;
  v_ancla text;
begin
  select pg_get_viewdef('public.v_clientes'::regclass, true) into v_def;

  -- 1) La lateral de pagos separa una cosa de la otra.
  v_ancla := 'SELECT sum(p.amount_bob) FILTER (WHERE p.purpose <> ''comision''::text) AS pagado_directo,';
  if position(v_ancla in v_def) = 0 then
    raise exception 'ANCLA_PAGOS_NO_ENCONTRADA';
  end if;
  v_def := replace(v_def, v_ancla, v_ancla || '
            sum(
              CASE
                WHEN p.purpose = ''reserva''::text THEN p.amount_bob
                WHEN p.purpose = ANY (ARRAY[''cuota''::text, ''abono''::text])
                  THEN p.amount_bob - COALESCE(p.interest_bob, 0::numeric)
                ELSE 0::numeric
              END) AS capital,
            sum(COALESCE(p.interest_bob, 0::numeric))
              FILTER (WHERE p.purpose = ANY (ARRAY[''cuota''::text, ''abono''::text])) AS interes,');

  -- 2) Las dos columnas nuevas, al final.
  v_ancla := 'COALESCE(vv.comprado, 0::numeric) AS comprado_total';
  if position(v_ancla in v_def) = 0 then
    raise exception 'ANCLA_COMPRADO_NO_ENCONTRADA';
  end if;
  v_def := replace(v_def, v_ancla, v_ancla || ',
    COALESCE(pg.capital, 0::numeric) + COALESCE(mig.abonado, 0::numeric) AS pagado_capital,
    COALESCE(pg.interes, 0::numeric) AS pagado_interes');

  -- 3) Y al GROUP BY.
  v_ancla := 'pg.pagado_directo, pg.comisiones';
  if position(v_ancla in v_def) = 0 then
    raise exception 'ANCLA_GROUP_BY_NO_ENCONTRADA';
  end if;
  v_def := replace(v_def, v_ancla, 'pg.pagado_directo, pg.capital, pg.interes, pg.comisiones');

  execute 'create or replace view public.v_clientes as ' || v_def;
  execute 'alter view public.v_clientes set (security_invoker = true)';
end $$;

-- Ahora sí: acordado − capital pagado = saldo, sin excusas de intereses.
select count(*) filter (where lotes_comprados > 0 and traspasos_cedidos = 0) as clientes_limpios,
       count(*) filter (where lotes_comprados > 0 and traspasos_cedidos = 0
                          and round(comprado_total - pagado_capital, 2) <> round(saldo_total, 2))
         as no_cuadran,
       round(sum(pagado_interes), 2) as interes_cobrado_total
  from public.v_clientes;
