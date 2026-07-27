select set_config('request.jwt.claims', '{"role":"service_role"}', false);
do $seed$
declare
  v_project uuid;
  v_id uuid;
begin
  select id into v_project from public.projects where slug = 'estrellas-del-sur';
  if v_project is null then raise exception 'proyecto no encontrado'; end if;
  v_id := ((public.save_manzana(
    v_project,
    'M-1',
    'residencial'::public.manzana_kind,
    'Este',
    $json$[[1216,262],[1296,262],[1296,312],[1216,312]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"8x10","frontB":"8x10","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[1216,262],[1226,262],[1226,287],[1216,287]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":true,"needs_review":true},{"number":"2","ring":[[1226,262],[1236,262],[1236,287],[1226,287]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"3","ring":[[1236,262],[1246,262],[1246,287],[1236,287]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"4","ring":[[1246,262],[1256,262],[1256,287],[1246,287]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"5","ring":[[1256,262],[1266,262],[1266,287],[1256,287]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"6","ring":[[1266,262],[1276,262],[1276,287],[1266,287]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"7","ring":[[1276,262],[1286,262],[1286,287],[1276,287]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"8","ring":[[1286,262],[1296,262],[1296,287],[1286,287]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":true,"needs_review":true},{"number":"9","ring":[[1286,287],[1296,287],[1296,312],[1286,312]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":true,"needs_review":true},{"number":"10","ring":[[1276,287],[1286,287],[1286,312],[1276,312]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"11","ring":[[1266,287],[1276,287],[1276,312],[1266,312]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"12","ring":[[1256,287],[1266,287],[1266,312],[1256,312]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"13","ring":[[1246,287],[1256,287],[1256,312],[1246,312]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"14","ring":[[1236,287],[1246,287],[1246,312],[1236,312]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"15","ring":[[1226,287],[1236,287],[1236,312],[1226,312]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"16","ring":[[1216,287],[1226,287],[1226,312],[1216,312]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-1 ok' as resultado;