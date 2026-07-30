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
    'M-57',
    'residencial'::public.manzana_kind,
    'Centro',
    $json$[[1200,331],[1200.44,328.22],[1201.72,325.71],[1203.71,323.72],[1206.22,322.44],[1209,322],[1241.37,322],[1244.15,322.44],[1246.66,323.72],[1248.65,325.71],[1249.93,328.22],[1250.37,331],[1250.37,373],[1249.93,375.78],[1248.65,378.29],[1246.66,380.28],[1244.15,381.56],[1241.37,382],[1209,382],[1206.22,381.56],[1203.71,380.28],[1201.72,378.29],[1200.44,375.78],[1200,373]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"12; 2x10; 12","frontB":"12; 2x10; 12","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[1225.19,325.71],[1248.65,325.71],[1249.93,328.22],[1250.37,331],[1250.37,337.71],[1225.19,337.71]],"frontage_m":12,"depth_m":25.18,"area_m2":298.84,"is_corner":true,"needs_review":true},{"number":"2","ring":[[1225.19,337.71],[1250.37,337.71],[1250.37,347.71],[1225.19,347.71]],"frontage_m":10,"depth_m":25.18,"area_m2":251.8,"is_corner":false,"needs_review":true},{"number":"3","ring":[[1225.19,347.71],[1250.37,347.71],[1250.37,357.71],[1225.19,357.71]],"frontage_m":10,"depth_m":25.18,"area_m2":251.8,"is_corner":false,"needs_review":true},{"number":"4","ring":[[1225.19,357.71],[1250.37,357.71],[1250.37,369.71],[1225.19,369.71]],"frontage_m":12,"depth_m":25.18,"area_m2":302.16,"is_corner":true,"needs_review":true},{"number":"5","ring":[[1200,366.29],[1225.19,366.29],[1225.19,378.29],[1201.72,378.29],[1200.44,375.78],[1200,373]],"frontage_m":12,"depth_m":25.19,"area_m2":298.96,"is_corner":true,"needs_review":true},{"number":"6","ring":[[1200,356.29],[1225.19,356.29],[1225.19,366.29],[1200,366.29]],"frontage_m":10,"depth_m":25.19,"area_m2":251.9,"is_corner":false,"needs_review":true},{"number":"7","ring":[[1200,346.29],[1225.19,346.29],[1225.19,356.29],[1200,356.29]],"frontage_m":10,"depth_m":25.19,"area_m2":251.9,"is_corner":false,"needs_review":true},{"number":"8","ring":[[1200,334.29],[1225.19,334.29],[1225.19,346.29],[1200,346.29]],"frontage_m":12,"depth_m":25.19,"area_m2":302.28,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-57 ok' as resultado;