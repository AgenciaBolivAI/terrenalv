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
    'M-2',
    'residencial'::public.manzana_kind,
    'Acceso',
    $json$[[2719,132],[2719.44,129.22],[2720.72,126.71],[2722.71,124.72],[2725.22,123.44],[2728,123],[2770,123],[2772.78,123.44],[2775.29,124.72],[2777.28,126.71],[2778.56,129.22],[2779,132],[2779,184],[2778.56,186.78],[2777.28,189.29],[2775.29,191.28],[2772.78,192.56],[2770,193],[2728,193],[2725.22,192.56],[2722.71,191.28],[2720.72,189.29],[2719.44,186.78],[2719,184]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"12; 3x10; 12","frontB":"12; 3x10; 12","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[2749,126.71],[2777.28,126.71],[2778.56,129.22],[2779,132],[2779,138.71],[2749,138.71]],"frontage_m":12,"depth_m":30,"area_m2":356.68,"is_corner":true,"needs_review":true},{"number":"2","ring":[[2749,138.71],[2779,138.71],[2779,148.71],[2749,148.71]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"3","ring":[[2749,148.71],[2779,148.71],[2779,158.71],[2749,158.71]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"4","ring":[[2749,158.71],[2779,158.71],[2779,168.71],[2749,168.71]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"5","ring":[[2749,168.71],[2779,168.71],[2779,180.71],[2749,180.71]],"frontage_m":12,"depth_m":30,"area_m2":360,"is_corner":true,"needs_review":true},{"number":"6","ring":[[2719,177.29],[2749,177.29],[2749,189.29],[2720.72,189.29],[2719.44,186.78],[2719,184]],"frontage_m":12,"depth_m":30,"area_m2":356.68,"is_corner":true,"needs_review":true},{"number":"7","ring":[[2719,167.29],[2749,167.29],[2749,177.29],[2719,177.29]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"8","ring":[[2719,157.29],[2749,157.29],[2749,167.29],[2719,167.29]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"9","ring":[[2719,147.29],[2749,147.29],[2749,157.29],[2719,157.29]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"10","ring":[[2719,135.29],[2749,135.29],[2749,147.29],[2719,147.29]],"frontage_m":12,"depth_m":30,"area_m2":360,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-2 ok' as resultado;