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
    'M-56',
    'residencial'::public.manzana_kind,
    'Centro',
    $json$[[1263.37,331],[1263.81,328.22],[1265.09,325.71],[1267.08,323.72],[1269.59,322.44],[1272.37,322],[1304.74,322],[1307.52,322.44],[1310.03,323.72],[1312.02,325.71],[1313.3,328.22],[1313.74,331],[1313.74,373],[1313.3,375.78],[1312.02,378.29],[1310.03,380.28],[1307.52,381.56],[1304.74,382],[1272.37,382],[1269.59,381.56],[1267.08,380.28],[1265.09,378.29],[1263.81,375.78],[1263.37,373]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"12; 2x10; 12","frontB":"12; 2x10; 12","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[1288.55,325.71],[1312.02,325.71],[1313.3,328.22],[1313.74,331],[1313.74,337.71],[1288.55,337.71]],"frontage_m":12,"depth_m":25.19,"area_m2":298.96,"is_corner":true,"needs_review":true},{"number":"2","ring":[[1288.55,337.71],[1313.74,337.71],[1313.74,347.71],[1288.55,347.71]],"frontage_m":10,"depth_m":25.19,"area_m2":251.9,"is_corner":false,"needs_review":true},{"number":"3","ring":[[1288.55,347.71],[1313.74,347.71],[1313.74,357.71],[1288.55,357.71]],"frontage_m":10,"depth_m":25.19,"area_m2":251.9,"is_corner":false,"needs_review":true},{"number":"4","ring":[[1288.55,357.71],[1313.74,357.71],[1313.74,369.71],[1288.55,369.71]],"frontage_m":12,"depth_m":25.19,"area_m2":302.28,"is_corner":true,"needs_review":true},{"number":"5","ring":[[1263.37,366.29],[1288.55,366.29],[1288.55,378.29],[1265.09,378.29],[1263.81,375.78],[1263.37,373]],"frontage_m":12,"depth_m":25.18,"area_m2":298.84,"is_corner":true,"needs_review":true},{"number":"6","ring":[[1263.37,356.29],[1288.55,356.29],[1288.55,366.29],[1263.37,366.29]],"frontage_m":10,"depth_m":25.18,"area_m2":251.8,"is_corner":false,"needs_review":true},{"number":"7","ring":[[1263.37,346.29],[1288.55,346.29],[1288.55,356.29],[1263.37,356.29]],"frontage_m":10,"depth_m":25.18,"area_m2":251.8,"is_corner":false,"needs_review":true},{"number":"8","ring":[[1263.37,334.29],[1288.55,334.29],[1288.55,346.29],[1263.37,346.29]],"frontage_m":12,"depth_m":25.18,"area_m2":302.16,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-56 ok' as resultado;