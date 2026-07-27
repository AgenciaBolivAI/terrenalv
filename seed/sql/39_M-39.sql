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
    'M-39',
    'area_verde'::public.manzana_kind,
    'Sur',
    $json$[[13,1252],[13.44,1249.22],[14.72,1246.71],[16.71,1244.72],[19.22,1243.44],[22,1243],[54,1243],[56.78,1243.44],[59.29,1244.72],[61.28,1246.71],[62.56,1249.22],[63,1252],[63,1411.5],[62.56,1414.28],[61.28,1416.79],[59.29,1418.78],[56.78,1420.06],[54,1420.5],[22,1420.5],[19.22,1420.06],[16.71,1418.78],[14.72,1416.79],[13.44,1414.28],[13,1411.5]]$json$::jsonb,
    null
  ))->>'id')::uuid;

  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-39 ok' as resultado;