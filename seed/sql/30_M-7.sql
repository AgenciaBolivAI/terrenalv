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
    'M-7',
    'residencial'::public.manzana_kind,
    'Este',
    $json$[[2330.55,331],[2330.99,328.22],[2332.27,325.71],[2334.26,323.72],[2336.77,322.44],[2339.55,322],[2362.7,322],[2365.48,322.44],[2367.99,323.72],[2369.98,325.71],[2371.26,328.22],[2371.7,331],[2371.7,373],[2371.26,375.78],[2369.98,378.29],[2367.99,380.28],[2365.48,381.56],[2362.7,382],[2339.55,382],[2336.77,381.56],[2334.26,380.28],[2332.27,378.29],[2330.99,375.78],[2330.55,373]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"12; 1x10; 12","frontB":"12; 1x10; 12","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[2351.13,325.71],[2369.98,325.71],[2371.26,328.22],[2371.7,331],[2371.7,337.71],[2351.13,337.71]],"frontage_m":12,"depth_m":20.57,"area_m2":243.52,"is_corner":true,"needs_review":true},{"number":"2","ring":[[2351.13,337.71],[2371.7,337.71],[2371.7,347.71],[2351.13,347.71]],"frontage_m":10,"depth_m":20.57,"area_m2":205.7,"is_corner":false,"needs_review":true},{"number":"3","ring":[[2351.13,347.71],[2371.7,347.71],[2371.7,359.71],[2351.13,359.71]],"frontage_m":12,"depth_m":20.57,"area_m2":246.84,"is_corner":true,"needs_review":true},{"number":"4","ring":[[2330.55,366.29],[2351.13,366.29],[2351.13,378.29],[2332.27,378.29],[2330.99,375.78],[2330.55,373]],"frontage_m":12,"depth_m":20.58,"area_m2":243.64,"is_corner":true,"needs_review":true},{"number":"5","ring":[[2330.55,356.29],[2351.13,356.29],[2351.13,366.29],[2330.55,366.29]],"frontage_m":10,"depth_m":20.58,"area_m2":205.8,"is_corner":false,"needs_review":true},{"number":"6","ring":[[2330.55,344.29],[2351.13,344.29],[2351.13,356.29],[2330.55,356.29]],"frontage_m":12,"depth_m":20.58,"area_m2":246.96,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-7 ok' as resultado;