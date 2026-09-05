-- `v_planes.pagado` sumaba `amount_paid` de TODAS las cuotas —anuladas
-- incluidas— cuando el resto de la vista (cuántas cuotas hay, cuántas están
-- pagadas, el saldo, el vencido) filtra las anuladas.
--
-- Se nota cuando un abono a capital rebobina el cronograma: las cuotas viejas
-- quedan `anulada` y nacen las nuevas. La plata cobrada sobre la cuota vieja
-- se quedaba pegada ahí, así que la pantalla decía «Pagado Bs 646,00 · 0 de 60
-- cuotas pagadas» y, al abrir el plan, las 60 cuotas pendientes. La cifra no
-- coincidía con la lista que abre, que es la regla que no se rompe.
--
-- La plata NO se pierde: el cronograma nuevo ya se armó sobre el capital que
-- quedaba, así que lo cobrado está adentro del saldo (31.485,18 en vez de los
-- ~77.500 originales), y el pago sigue entero en el historial del cliente, en
-- Ventas y en el libro. Lo que se corrige es que Planes deje de contar dos
-- veces una historia que su propio cronograma ya no muestra.
do $$
declare
  v_def text;
  v_viejo text := 'sum(i.amount_paid) AS pagado,';
  v_nuevo text := 'sum(i.amount_paid) FILTER (WHERE i.status <> ''anulada''::installment_status) AS pagado,';
begin
  select pg_get_viewdef('public.v_planes'::regclass, true) into v_def;

  if position(v_viejo in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA: no se encontró la suma de pagado en v_planes';
  end if;
  if position('FILTER (WHERE i.status <> ''anulada''::installment_status) AS pagado' in v_def) > 0 then
    raise exception 'PARCHE_NO_AGARRA: el filtro ya estaba';
  end if;

  execute 'create or replace view public.v_planes with (security_invoker = true) as '
        || replace(v_def, v_viejo, v_nuevo);
end $$;
