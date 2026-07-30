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
    'M-43',
    'residencial'::public.manzana_kind,
    'Centro',
    $json$[[1629.11,331],[1629.55,328.22],[1630.83,325.71],[1632.82,323.72],[1635.33,322.44],[1638.11,322],[1661.78,322],[1664.56,322.44],[1667.07,323.72],[1669.06,325.71],[1670.34,328.22],[1670.78,331],[1670.78,373],[1670.34,375.78],[1669.06,378.29],[1667.07,380.28],[1664.56,381.56],[1661.78,382],[1638.11,382],[1635.33,381.56],[1632.82,380.28],[1630.83,378.29],[1629.55,375.78],[1629.11,373]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"12; 1x10; 12","frontB":"12; 1x10; 12","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[1629.11,366.29],[1649.95,366.29],[1649.95,378.29],[1630.83,378.29],[1629.55,375.78],[1629.11,373]],"frontage_m":12,"depth_m":20.84,"area_m2":246.76,"is_corner":true,"needs_review":true},{"number":"2","ring":[[1629.11,356.29],[1649.95,356.29],[1649.95,366.29],[1629.11,366.29]],"frontage_m":10,"depth_m":20.84,"area_m2":208.4,"is_corner":false,"needs_review":true},{"number":"3","ring":[[1629.11,344.29],[1649.95,344.29],[1649.95,356.29],[1629.11,356.29]],"frontage_m":12,"depth_m":20.84,"area_m2":250.08,"is_corner":true,"needs_review":true},{"number":"4","ring":[[1649.95,325.71],[1669.06,325.71],[1670.34,328.22],[1670.78,331],[1670.78,337.71],[1649.95,337.71]],"frontage_m":12,"depth_m":20.83,"area_m2":246.64,"is_corner":true,"needs_review":true},{"number":"5","ring":[[1649.95,337.71],[1670.78,337.71],[1670.78,347.71],[1649.95,347.71]],"frontage_m":10,"depth_m":20.83,"area_m2":208.3,"is_corner":false,"needs_review":true},{"number":"6","ring":[[1649.95,347.71],[1670.78,347.71],[1670.78,359.71],[1649.95,359.71]],"frontage_m":12,"depth_m":20.83,"area_m2":249.96,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-43 ok' as resultado;