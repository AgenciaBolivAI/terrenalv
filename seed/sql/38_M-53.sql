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
    'M-53',
    'residencial'::public.manzana_kind,
    'Centro',
    $json$[[1295.06,258],[1295.5,255.22],[1296.77,252.71],[1298.77,250.72],[1301.27,249.44],[1304.06,249],[1368.11,249],[1370.89,249.44],[1373.4,250.72],[1375.39,252.71],[1376.67,255.22],[1377.11,258],[1377.11,300],[1376.67,302.78],[1375.39,305.29],[1373.4,307.28],[1370.89,308.56],[1368.11,309],[1304.06,309],[1301.27,308.56],[1298.77,307.28],[1296.77,305.29],[1295.5,302.78],[1295.06,300]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"12; 5x10; 12","frontB":"12; 5x10; 12","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[1296.77,252.71],[1298.77,250.72],[1301.27,249.44],[1304.06,249],[1308.77,249],[1308.77,279],[1296.77,279]],"frontage_m":12,"depth_m":30,"area_m2":351.26,"is_corner":true,"needs_review":true},{"number":"2","ring":[[1308.77,249],[1318.77,249],[1318.77,279],[1308.77,279]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"3","ring":[[1318.77,249],[1328.77,249],[1328.77,279],[1318.77,279]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"4","ring":[[1328.77,249],[1338.77,249],[1338.77,279],[1328.77,279]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"5","ring":[[1338.77,249],[1348.77,249],[1348.77,279],[1338.77,279]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"6","ring":[[1348.77,249],[1358.77,249],[1358.77,279],[1348.77,279]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"7","ring":[[1358.77,249],[1368.11,249],[1370.77,249.42],[1370.77,279],[1358.77,279]],"frontage_m":12,"depth_m":30,"area_m2":359.44,"is_corner":true,"needs_review":true},{"number":"8","ring":[[1363.39,279],[1375.39,279],[1375.39,305.29],[1373.4,307.28],[1370.89,308.56],[1368.11,309],[1363.39,309]],"frontage_m":12,"depth_m":30,"area_m2":351.27,"is_corner":true,"needs_review":true},{"number":"9","ring":[[1353.39,279],[1363.39,279],[1363.39,309],[1353.39,309]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"10","ring":[[1343.39,279],[1353.39,279],[1353.39,309],[1343.39,309]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"11","ring":[[1333.39,279],[1343.39,279],[1343.39,309],[1333.39,309]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"12","ring":[[1323.39,279],[1333.39,279],[1333.39,309],[1323.39,309]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"13","ring":[[1313.39,279],[1323.39,279],[1323.39,309],[1313.39,309]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"14","ring":[[1301.39,279],[1313.39,279],[1313.39,309],[1304.06,309],[1301.39,308.58]],"frontage_m":12,"depth_m":30,"area_m2":359.44,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-53 ok' as resultado;