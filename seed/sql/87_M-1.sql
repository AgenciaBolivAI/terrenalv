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
    'M-1',
    'residencial'::public.manzana_kind,
    'Acceso',
    $json$[[2719,224],[2719.44,221.22],[2720.72,218.71],[2722.71,216.72],[2725.22,215.44],[2728,215],[2770,215],[2772.78,215.44],[2775.29,216.72],[2777.28,218.71],[2778.56,221.22],[2779,224],[2779,276],[2778.56,278.78],[2777.28,281.29],[2775.29,283.28],[2772.78,284.56],[2770,285],[2728,285],[2725.22,284.56],[2722.71,283.28],[2720.72,281.29],[2719.44,278.78],[2719,276]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"12; 3x10; 12","frontB":"12; 3x10; 12","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[2749,218.71],[2777.28,218.71],[2778.56,221.22],[2779,224],[2779,230.71],[2749,230.71]],"frontage_m":12,"depth_m":30,"area_m2":356.68,"is_corner":true,"needs_review":true},{"number":"2","ring":[[2749,230.71],[2779,230.71],[2779,240.71],[2749,240.71]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"3","ring":[[2749,240.71],[2779,240.71],[2779,250.71],[2749,250.71]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"4","ring":[[2749,250.71],[2779,250.71],[2779,260.71],[2749,260.71]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"5","ring":[[2749,260.71],[2779,260.71],[2779,272.71],[2749,272.71]],"frontage_m":12,"depth_m":30,"area_m2":360,"is_corner":true,"needs_review":true},{"number":"6","ring":[[2719,269.29],[2749,269.29],[2749,281.29],[2720.72,281.29],[2719.44,278.78],[2719,276]],"frontage_m":12,"depth_m":30,"area_m2":356.68,"is_corner":true,"needs_review":true},{"number":"7","ring":[[2719,259.29],[2749,259.29],[2749,269.29],[2719,269.29]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"8","ring":[[2719,249.29],[2749,249.29],[2749,259.29],[2719,259.29]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"9","ring":[[2719,239.29],[2749,239.29],[2749,249.29],[2719,249.29]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"10","ring":[[2719,227.29],[2749,227.29],[2749,239.29],[2719,239.29]],"frontage_m":12,"depth_m":30,"area_m2":360,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-1 ok' as resultado;