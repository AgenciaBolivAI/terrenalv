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
    'M-2',
    'residencial'::public.manzana_kind,
    'Este',
    $json$[[1216,199],[1296,199],[1296,249],[1216,249]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"8x10","frontB":"8x10","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[1216,199],[1226,199],[1226,224],[1216,224]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":true,"needs_review":true},{"number":"2","ring":[[1226,199],[1236,199],[1236,224],[1226,224]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"3","ring":[[1236,199],[1246,199],[1246,224],[1236,224]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"4","ring":[[1246,199],[1256,199],[1256,224],[1246,224]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"5","ring":[[1256,199],[1266,199],[1266,224],[1256,224]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"6","ring":[[1266,199],[1276,199],[1276,224],[1266,224]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"7","ring":[[1276,199],[1286,199],[1286,224],[1276,224]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"8","ring":[[1286,199],[1296,199],[1296,224],[1286,224]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":true,"needs_review":true},{"number":"9","ring":[[1286,224],[1296,224],[1296,249],[1286,249]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":true,"needs_review":true},{"number":"10","ring":[[1276,224],[1286,224],[1286,249],[1276,249]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"11","ring":[[1266,224],[1276,224],[1276,249],[1266,249]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"12","ring":[[1256,224],[1266,224],[1266,249],[1256,249]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"13","ring":[[1246,224],[1256,224],[1256,249],[1246,249]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"14","ring":[[1236,224],[1246,224],[1246,249],[1236,249]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"15","ring":[[1226,224],[1236,224],[1236,249],[1226,249]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"16","ring":[[1216,224],[1226,224],[1226,249],[1216,249]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-2 ok' as resultado;