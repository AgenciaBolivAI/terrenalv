select set_config('request.jwt.claims', '{"role":"service_role"}', false);
do $seed$
declare
  v_project uuid;
  v_id uuid;
begin
  select id into v_project from public.projects where slug = 'estrellas-del-sur';
  if v_project is null then raise exception 'proyecto no encontrado'; end if;
  v_id := ((public.save_manzana(
    v_project,
    'M-62',
    'equipamiento'::public.manzana_kind,
    'Norte',
    $json$[[341,1823.5],[341.44,1820.72],[342.72,1818.21],[344.71,1816.22],[347.22,1814.94],[350,1814.5],[382,1814.5],[384.78,1814.94],[387.29,1816.22],[389.28,1818.21],[390.56,1820.72],[391,1823.5],[391,1983],[390.56,1985.78],[389.28,1988.29],[387.29,1990.28],[384.78,1991.56],[382,1992],[350,1992],[347.22,1991.56],[344.71,1990.28],[342.72,1988.29],[341.44,1985.78],[341,1983]]$json$::jsonb,
    null
  ))->>'id')::uuid;

  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-62 ok' as resultado;