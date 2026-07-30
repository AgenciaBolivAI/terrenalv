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
    'M-46',
    'residencial'::public.manzana_kind,
    'Centro',
    $json$[[1465.11,331],[1465.55,328.22],[1466.83,325.71],[1468.82,323.72],[1471.33,322.44],[1474.11,322],[1497.78,322],[1500.56,322.44],[1503.07,323.72],[1505.06,325.71],[1506.34,328.22],[1506.78,331],[1506.78,373],[1506.34,375.78],[1505.06,378.29],[1503.07,380.28],[1500.56,381.56],[1497.78,382],[1474.11,382],[1471.33,381.56],[1468.82,380.28],[1466.83,378.29],[1465.55,375.78],[1465.11,373]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"12; 1x10; 12","frontB":"12; 1x10; 12","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[1465.11,366.29],[1485.95,366.29],[1485.95,378.29],[1466.83,378.29],[1465.55,375.78],[1465.11,373]],"frontage_m":12,"depth_m":20.84,"area_m2":246.76,"is_corner":true,"needs_review":true},{"number":"2","ring":[[1465.11,356.29],[1485.95,356.29],[1485.95,366.29],[1465.11,366.29]],"frontage_m":10,"depth_m":20.84,"area_m2":208.4,"is_corner":false,"needs_review":true},{"number":"3","ring":[[1465.11,344.29],[1485.95,344.29],[1485.95,356.29],[1465.11,356.29]],"frontage_m":12,"depth_m":20.84,"area_m2":250.08,"is_corner":true,"needs_review":true},{"number":"4","ring":[[1485.95,325.71],[1505.06,325.71],[1506.34,328.22],[1506.78,331],[1506.78,337.71],[1485.95,337.71]],"frontage_m":12,"depth_m":20.83,"area_m2":246.64,"is_corner":true,"needs_review":true},{"number":"5","ring":[[1485.95,337.71],[1506.78,337.71],[1506.78,347.71],[1485.95,347.71]],"frontage_m":10,"depth_m":20.83,"area_m2":208.3,"is_corner":false,"needs_review":true},{"number":"6","ring":[[1485.95,347.71],[1506.78,347.71],[1506.78,359.71],[1485.95,359.71]],"frontage_m":12,"depth_m":20.83,"area_m2":249.96,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-46 ok' as resultado;