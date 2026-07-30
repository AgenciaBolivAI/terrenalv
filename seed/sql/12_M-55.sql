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
    'M-55',
    'residencial'::public.manzana_kind,
    'Centro',
    $json$[[1326.74,331],[1327.18,328.22],[1328.46,325.71],[1330.45,323.72],[1332.96,322.44],[1335.74,322],[1368.11,322],[1370.89,322.44],[1373.4,323.72],[1375.39,325.71],[1376.67,328.22],[1377.11,331],[1377.11,373],[1376.67,375.78],[1375.39,378.29],[1373.4,380.28],[1370.89,381.56],[1368.11,382],[1335.74,382],[1332.96,381.56],[1330.45,380.28],[1328.46,378.29],[1327.18,375.78],[1326.74,373]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"12; 2x10; 12","frontB":"12; 2x10; 12","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[1351.93,325.71],[1375.39,325.71],[1376.67,328.22],[1377.11,331],[1377.11,337.71],[1351.93,337.71]],"frontage_m":12,"depth_m":25.18,"area_m2":298.84,"is_corner":true,"needs_review":true},{"number":"2","ring":[[1351.93,337.71],[1377.11,337.71],[1377.11,347.71],[1351.93,347.71]],"frontage_m":10,"depth_m":25.18,"area_m2":251.8,"is_corner":false,"needs_review":true},{"number":"3","ring":[[1351.93,347.71],[1377.11,347.71],[1377.11,357.71],[1351.93,357.71]],"frontage_m":10,"depth_m":25.18,"area_m2":251.8,"is_corner":false,"needs_review":true},{"number":"4","ring":[[1351.93,357.71],[1377.11,357.71],[1377.11,369.71],[1351.93,369.71]],"frontage_m":12,"depth_m":25.18,"area_m2":302.16,"is_corner":true,"needs_review":true},{"number":"5","ring":[[1326.74,366.29],[1351.93,366.29],[1351.93,378.29],[1328.46,378.29],[1327.18,375.78],[1326.74,373]],"frontage_m":12,"depth_m":25.19,"area_m2":298.96,"is_corner":true,"needs_review":true},{"number":"6","ring":[[1326.74,356.29],[1351.93,356.29],[1351.93,366.29],[1326.74,366.29]],"frontage_m":10,"depth_m":25.19,"area_m2":251.9,"is_corner":false,"needs_review":true},{"number":"7","ring":[[1326.74,346.29],[1351.93,346.29],[1351.93,356.29],[1326.74,356.29]],"frontage_m":10,"depth_m":25.19,"area_m2":251.9,"is_corner":false,"needs_review":true},{"number":"8","ring":[[1326.74,334.29],[1351.93,334.29],[1351.93,346.29],[1326.74,346.29]],"frontage_m":12,"depth_m":25.19,"area_m2":302.28,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-55 ok' as resultado;