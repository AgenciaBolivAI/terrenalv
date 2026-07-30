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
    'M-5',
    'residencial'::public.manzana_kind,
    'Este',
    $json$[[2438.85,331],[2439.29,328.22],[2440.57,325.71],[2442.56,323.72],[2445.07,322.44],[2447.85,322],[2471,322],[2473.78,322.44],[2476.29,323.72],[2478.28,325.71],[2479.56,328.22],[2480,331],[2480,373],[2479.56,375.78],[2478.28,378.29],[2476.29,380.28],[2473.78,381.56],[2471,382],[2447.85,382],[2445.07,381.56],[2442.56,380.28],[2440.57,378.29],[2439.29,375.78],[2438.85,373]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"12; 1x10; 12","frontB":"12; 1x10; 12","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[2459.42,325.71],[2478.28,325.71],[2479.56,328.22],[2480,331],[2480,337.71],[2459.42,337.71]],"frontage_m":12,"depth_m":20.58,"area_m2":243.64,"is_corner":true,"needs_review":true},{"number":"2","ring":[[2459.42,337.71],[2480,337.71],[2480,347.71],[2459.42,347.71]],"frontage_m":10,"depth_m":20.58,"area_m2":205.8,"is_corner":false,"needs_review":true},{"number":"3","ring":[[2459.42,347.71],[2480,347.71],[2480,359.71],[2459.42,359.71]],"frontage_m":12,"depth_m":20.58,"area_m2":246.96,"is_corner":true,"needs_review":true},{"number":"4","ring":[[2438.85,368.28],[2459.42,368.28],[2459.42,380.28],[2442.56,380.28],[2440.57,378.29],[2439.29,375.78],[2438.85,373]],"frontage_m":12,"depth_m":20.57,"area_m2":238.11,"is_corner":true,"needs_review":true},{"number":"5","ring":[[2438.85,358.28],[2459.42,358.28],[2459.42,368.28],[2438.85,368.28]],"frontage_m":10,"depth_m":20.57,"area_m2":205.7,"is_corner":false,"needs_review":true},{"number":"6","ring":[[2438.85,346.28],[2459.42,346.28],[2459.42,358.28],[2438.85,358.28]],"frontage_m":12,"depth_m":20.57,"area_m2":246.84,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-5 ok' as resultado;