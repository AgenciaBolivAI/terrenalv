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
    'M-45',
    'residencial'::public.manzana_kind,
    'Centro',
    $json$[[1519.78,331],[1520.22,328.22],[1521.5,325.71],[1523.49,323.72],[1526,322.44],[1528.78,322],[1552.44,322],[1555.23,322.44],[1557.73,323.72],[1559.73,325.71],[1561,328.22],[1561.44,331],[1561.44,373],[1561,375.78],[1559.73,378.29],[1557.73,380.28],[1555.23,381.56],[1552.44,382],[1528.78,382],[1526,381.56],[1523.49,380.28],[1521.5,378.29],[1520.22,375.78],[1519.78,373]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"12; 1x10; 12","frontB":"12; 1x10; 12","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[1540.61,325.71],[1559.73,325.71],[1561,328.22],[1561.44,331],[1561.44,337.71],[1540.61,337.71]],"frontage_m":12,"depth_m":20.83,"area_m2":246.65,"is_corner":true,"needs_review":true},{"number":"2","ring":[[1540.61,337.71],[1561.44,337.71],[1561.44,347.71],[1540.61,347.71]],"frontage_m":10,"depth_m":20.83,"area_m2":208.3,"is_corner":false,"needs_review":true},{"number":"3","ring":[[1540.61,347.71],[1561.44,347.71],[1561.44,359.71],[1540.61,359.71]],"frontage_m":12,"depth_m":20.83,"area_m2":249.96,"is_corner":true,"needs_review":true},{"number":"4","ring":[[1519.78,366.29],[1540.61,366.29],[1540.61,378.29],[1521.5,378.29],[1520.22,375.78],[1519.78,373]],"frontage_m":12,"depth_m":20.83,"area_m2":246.64,"is_corner":true,"needs_review":true},{"number":"5","ring":[[1519.78,356.29],[1540.61,356.29],[1540.61,366.29],[1519.78,366.29]],"frontage_m":10,"depth_m":20.83,"area_m2":208.3,"is_corner":false,"needs_review":true},{"number":"6","ring":[[1519.78,344.29],[1540.61,344.29],[1540.61,356.29],[1519.78,356.29]],"frontage_m":12,"depth_m":20.83,"area_m2":249.96,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-45 ok' as resultado;