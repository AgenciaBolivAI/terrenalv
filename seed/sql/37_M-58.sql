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
    'M-58',
    'residencial'::public.manzana_kind,
    'Centro',
    $json$[[1200,258],[1200.44,255.22],[1201.72,252.71],[1203.71,250.72],[1206.22,249.44],[1209,249],[1273.06,249],[1275.84,249.44],[1278.35,250.72],[1280.34,252.71],[1281.62,255.22],[1282.06,258],[1282.06,300],[1281.62,302.78],[1280.34,305.29],[1278.35,307.28],[1275.84,308.56],[1273.06,309],[1209,309],[1206.22,308.56],[1203.71,307.28],[1201.72,305.29],[1200.44,302.78],[1200,300]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"12; 5x10; 12","frontB":"12; 5x10; 12","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[1203.71,250.72],[1206.22,249.44],[1209,249],[1215.71,249],[1215.71,279],[1203.71,279]],"frontage_m":12,"depth_m":30,"area_m2":356.68,"is_corner":true,"needs_review":true},{"number":"2","ring":[[1215.71,249],[1225.71,249],[1225.71,279],[1215.71,279]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"3","ring":[[1225.71,249],[1235.71,249],[1235.71,279],[1225.71,279]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"4","ring":[[1235.71,249],[1245.71,249],[1245.71,279],[1235.71,279]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"5","ring":[[1245.71,249],[1255.71,249],[1255.71,279],[1245.71,279]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"6","ring":[[1255.71,249],[1265.71,249],[1265.71,279],[1255.71,279]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"7","ring":[[1265.71,249],[1273.06,249],[1275.84,249.44],[1277.71,250.39],[1277.71,279],[1265.71,279]],"frontage_m":12,"depth_m":30,"area_m2":357.68,"is_corner":true,"needs_review":true},{"number":"8","ring":[[1268.34,279],[1280.34,279],[1280.34,305.29],[1278.35,307.28],[1275.84,308.56],[1273.06,309],[1268.34,309]],"frontage_m":12,"depth_m":30,"area_m2":351.27,"is_corner":true,"needs_review":true},{"number":"9","ring":[[1258.34,279],[1268.34,279],[1268.34,309],[1258.34,309]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"10","ring":[[1248.34,279],[1258.34,279],[1258.34,309],[1248.34,309]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"11","ring":[[1238.34,279],[1248.34,279],[1248.34,309],[1238.34,309]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"12","ring":[[1228.34,279],[1238.34,279],[1238.34,309],[1228.34,309]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"13","ring":[[1218.34,279],[1228.34,279],[1228.34,309],[1218.34,309]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"14","ring":[[1206.34,279],[1218.34,279],[1218.34,309],[1209,309],[1206.34,308.58]],"frontage_m":12,"depth_m":30,"area_m2":359.44,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-58 ok' as resultado;