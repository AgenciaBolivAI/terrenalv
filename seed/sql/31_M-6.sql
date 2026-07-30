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
    'M-6',
    'residencial'::public.manzana_kind,
    'Este',
    $json$[[2384.7,331],[2385.14,328.22],[2386.42,325.71],[2388.41,323.72],[2390.92,322.44],[2393.7,322],[2416.85,322],[2419.63,322.44],[2422.14,323.72],[2424.13,325.71],[2425.41,328.22],[2425.85,331],[2425.85,373],[2425.41,375.78],[2424.13,378.29],[2422.14,380.28],[2419.63,381.56],[2416.85,382],[2393.7,382],[2390.92,381.56],[2388.41,380.28],[2386.42,378.29],[2385.14,375.78],[2384.7,373]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"12; 1x10; 12","frontB":"12; 1x10; 12","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[2405.27,325.71],[2424.13,325.71],[2425.41,328.22],[2425.85,331],[2425.85,337.71],[2405.27,337.71]],"frontage_m":12,"depth_m":20.58,"area_m2":243.64,"is_corner":true,"needs_review":true},{"number":"2","ring":[[2405.27,337.71],[2425.85,337.71],[2425.85,347.71],[2405.27,347.71]],"frontage_m":10,"depth_m":20.58,"area_m2":205.8,"is_corner":false,"needs_review":true},{"number":"3","ring":[[2405.27,347.71],[2425.85,347.71],[2425.85,359.71],[2405.27,359.71]],"frontage_m":12,"depth_m":20.58,"area_m2":246.96,"is_corner":true,"needs_review":true},{"number":"4","ring":[[2384.7,368.28],[2405.27,368.28],[2405.27,380.28],[2388.41,380.28],[2386.42,378.29],[2385.14,375.78],[2384.7,373]],"frontage_m":12,"depth_m":20.57,"area_m2":238.11,"is_corner":true,"needs_review":true},{"number":"5","ring":[[2384.7,358.28],[2405.27,358.28],[2405.27,368.28],[2384.7,368.28]],"frontage_m":10,"depth_m":20.57,"area_m2":205.7,"is_corner":false,"needs_review":true},{"number":"6","ring":[[2384.7,346.28],[2405.27,346.28],[2405.27,358.28],[2384.7,358.28]],"frontage_m":12,"depth_m":20.57,"area_m2":246.84,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-6 ok' as resultado;