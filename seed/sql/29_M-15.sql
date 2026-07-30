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
    'M-15',
    'residencial'::public.manzana_kind,
    'Este',
    $json$[[2276.4,331],[2276.84,328.22],[2278.12,325.71],[2280.11,323.72],[2282.62,322.44],[2285.4,322],[2308.55,322],[2311.33,322.44],[2313.84,323.72],[2315.83,325.71],[2317.11,328.22],[2317.55,331],[2317.55,373],[2317.11,375.78],[2315.83,378.29],[2313.84,380.28],[2311.33,381.56],[2308.55,382],[2285.4,382],[2282.62,381.56],[2280.11,380.28],[2278.12,378.29],[2276.84,375.78],[2276.4,373]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"12; 1x10; 12","frontB":"12; 1x10; 12","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[2296.97,323.72],[2313.84,323.72],[2315.83,325.71],[2317.11,328.22],[2317.55,331],[2317.55,335.72],[2296.97,335.72]],"frontage_m":12,"depth_m":20.58,"area_m2":238.23,"is_corner":true,"needs_review":true},{"number":"2","ring":[[2296.97,335.72],[2317.55,335.72],[2317.55,345.72],[2296.97,345.72]],"frontage_m":10,"depth_m":20.58,"area_m2":205.8,"is_corner":false,"needs_review":true},{"number":"3","ring":[[2296.97,345.72],[2317.55,345.72],[2317.55,357.72],[2296.97,357.72]],"frontage_m":12,"depth_m":20.58,"area_m2":246.96,"is_corner":true,"needs_review":true},{"number":"4","ring":[[2276.4,366.29],[2296.97,366.29],[2296.97,378.29],[2278.12,378.29],[2276.84,375.78],[2276.4,373]],"frontage_m":12,"depth_m":20.57,"area_m2":243.52,"is_corner":true,"needs_review":true},{"number":"5","ring":[[2276.4,356.29],[2296.97,356.29],[2296.97,366.29],[2276.4,366.29]],"frontage_m":10,"depth_m":20.57,"area_m2":205.7,"is_corner":false,"needs_review":true},{"number":"6","ring":[[2276.4,344.29],[2296.97,344.29],[2296.97,356.29],[2276.4,356.29]],"frontage_m":12,"depth_m":20.57,"area_m2":246.84,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-15 ok' as resultado;