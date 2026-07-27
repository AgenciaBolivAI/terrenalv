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
    'M-71',
    'area_verde'::public.manzana_kind,
    'Norte',
    $json$[[139,2204.5],[139.44,2201.72],[140.72,2199.21],[142.71,2197.22],[145.22,2195.94],[148,2195.5],[180,2195.5],[182.78,2195.94],[185.29,2197.22],[187.28,2199.21],[188.56,2201.72],[189,2204.5],[189,2364],[188.56,2366.78],[187.28,2369.29],[185.29,2371.28],[182.78,2372.56],[180,2373],[148,2373],[145.22,2372.56],[142.71,2371.28],[140.72,2369.29],[139.44,2366.78],[139,2364]]$json$::jsonb,
    null
  ))->>'id')::uuid;

  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-71 ok' as resultado;