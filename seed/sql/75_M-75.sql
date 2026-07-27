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
    'M-75',
    'equipamiento'::public.manzana_kind,
    'Norte',
    $json$[[13,2395],[13.44,2392.22],[14.72,2389.71],[16.71,2387.72],[19.22,2386.44],[22,2386],[54,2386],[56.78,2386.44],[59.29,2387.72],[61.28,2389.71],[62.56,2392.22],[63,2395],[63,2554.5],[62.56,2557.28],[61.28,2559.79],[59.29,2561.78],[56.78,2563.06],[54,2563.5],[22,2563.5],[19.22,2563.06],[16.71,2561.78],[14.72,2559.79],[13.44,2557.28],[13,2554.5]]$json$::jsonb,
    null
  ))->>'id')::uuid;

  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-75 ok' as resultado;