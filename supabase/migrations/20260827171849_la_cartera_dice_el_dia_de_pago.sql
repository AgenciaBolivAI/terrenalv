-- El día de pago mensual: el día del mes en que le vencen las cuotas a ese
-- comprador (el 5, el 15, el 26...). Sale de la próxima cuota pendiente — y
-- si ya no hay pendientes, de la primera del plan, que fijó el ritmo.
do $$
declare v_def text; v_ancla text;
begin
  select pg_get_viewdef('public.v_cartera'::regclass, true) into v_def;

  -- La lateral trae también first_due_date, para el día de pago de los
  -- planes ya cancelados.
  v_ancla := 'pp.proxima_cuota';
  if position(v_ancla in v_def) = 0 then raise exception 'ANCLA_LATERAL'; end if;
  v_def := replace(v_def, v_ancla, v_ancla || ',
            pp.first_due_date');

  -- Y la columna, al final como siempre.
  v_ancla := 'v.ultimo_pago AS fecha_ultimo_pago';
  if position(v_ancla in v_def) = 0 then raise exception 'ANCLA_FINAL'; end if;
  v_def := replace(v_def, v_ancla, v_ancla || ',
    EXTRACT(day FROM COALESCE(pl.proxima_cuota, pl.first_due_date))::int AS dia_de_pago');

  execute 'create or replace view public.v_cartera as ' || v_def;
  execute 'alter view public.v_cartera set (security_invoker = true)';
end $$;

select count(*) as filas,
       count(dia_de_pago) as con_dia_de_pago,
       string_agg(distinct dia_de_pago::text, ', ') as dias_vistos
  from public.v_cartera;
