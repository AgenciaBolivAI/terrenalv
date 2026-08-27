-- LA TASA MENSUAL NECESITA DECIMALES.
--
-- Se pacta 20 % anual y el motor cobra por mes: 20/12 = 1,666666…%. La columna
-- era numeric(6,3), así que la tasa quedaba en 1,667 — o en 1,67, como está el
-- plan cargado. Parece nada y no lo es: sobre Bs 24.400 a 60 meses el sistema
-- viejo (RepCarCons, «Tasa Int 20») cobra Bs 646,44 de cuota y Bs 14.386,24 de
-- interés total; con 1,67 salía Bs 646,99 y Bs 14.419,83. Bs 0,55 por mes
-- durante 60 meses, en cada contrato.
--
-- Con seis decimales, 1,666667 da Bs 646,45 y Bs 14.387: a un centavo del
-- sistema que el equipo viene usando.
--
-- Las tres vistas que cuelgan de la columna se recrean con su propia
-- definición leída de la base —no transcrita— con sus opciones y sus permisos.
do $$
declare
  v_planes text;
  v_cartera text;
  v_clientes text;
  v_rel text;
begin
  select pg_get_viewdef('public.v_planes'::regclass, true)   into v_planes;
  select pg_get_viewdef('public.v_cartera'::regclass, true)  into v_cartera;
  select pg_get_viewdef('public.v_clientes'::regclass, true) into v_clientes;

  drop view public.v_cartera;
  drop view public.v_clientes;
  drop view public.v_planes;

  alter table public.installment_plans
    alter column monthly_interest_pct type numeric(9,6),
    alter column annual_interest_pct  type numeric(9,6);
  alter table public.financing_tiers
    alter column monthly_interest_pct type numeric(9,6);

  execute 'create view public.v_planes as '   || v_planes;
  execute 'create view public.v_clientes as ' || v_clientes;
  execute 'create view public.v_cartera as '  || v_cartera;

  foreach v_rel in array array['v_planes', 'v_clientes', 'v_cartera'] loop
    execute format('alter view public.%I set (security_invoker = true)', v_rel);
    execute format('grant select on public.%I to anon, authenticated, service_role', v_rel);
  end loop;
end $$;

-- La derivación deja de perder decimales.
do $$
declare
  v_src text;
  v_old text := $blk$    v_tasa := round(p_annual_interest_pct / 12.0, 3);$blk$;
  v_new text := $blk$    v_tasa := round(p_annual_interest_pct / 12.0, 6);$blk$;
begin
  select pg_get_functiondef(oid) into v_src
  from pg_proc where proname='admin_create_installment_plan' and pronamespace='public'::regnamespace;
  if position(v_old in v_src) = 0 then
    raise exception 'no encontré la derivación de la tasa';
  end if;
  v_src := replace(v_src, 'round(v_tasa * 12, 3), v_tasa, v_first, p_note, v_actor)',
                          'round(v_tasa * 12, 6), v_tasa, v_first, p_note, v_actor)');
  execute replace(v_src, v_old, v_new);
end $$;

do $$
declare v_src text;
begin
  select pg_get_functiondef(oid) into v_src
  from pg_proc where proname='admin_editar_plan' and pronamespace='public'::regnamespace;
  execute replace(v_src, 'annual_interest_pct = round(v_tasa * 12, 3),',
                         'annual_interest_pct = round(v_tasa * 12, 6),');
end $$;
