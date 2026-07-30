select set_config('request.jwt.claims', '{"role":"service_role"}', false);
do $seed$
declare
  v_project uuid;
  v_id uuid;
begin
  select id into v_project from public.projects where slug = 'prados-del-sur';
  if v_project is null then raise exception 'proyecto no encontrado'; end if;
  v_id := ((public.save_manzana(
    v_project,
    'M-84',
    'residencial'::public.manzana_kind,
    'Oeste',
    $json$[[0,22],[0.44,19.22],[1.72,16.71],[3.71,14.72],[6.22,13.44],[9,13],[23,13],[25.78,13.44],[28.29,14.72],[30.28,16.71],[31.56,19.22],[32,22],[32,64],[31.56,66.78],[30.28,69.29],[28.29,71.28],[25.78,72.56],[23,73],[9,73],[6.22,72.56],[3.71,71.28],[1.72,69.29],[0.44,66.78],[0,64]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"16; 16","frontB":"16; 16","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[0,53.29],[16,53.29],[16,69.29],[1.72,69.29],[0.44,66.78],[0,64]],"frontage_m":16,"depth_m":16,"area_m2":252.68,"is_corner":true,"needs_review":true},{"number":"2","ring":[[0,37.29],[16,37.29],[16,53.29],[0,53.29]],"frontage_m":16,"depth_m":16,"area_m2":256,"is_corner":true,"needs_review":true},{"number":"3","ring":[[16,16.71],[30.28,16.71],[31.56,19.22],[32,22],[32,32.71],[16,32.71]],"frontage_m":16,"depth_m":16,"area_m2":252.68,"is_corner":true,"needs_review":true},{"number":"4","ring":[[16,32.71],[32,32.71],[32,48.71],[16,48.71]],"frontage_m":16,"depth_m":16,"area_m2":256,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-84 ok' as resultado;