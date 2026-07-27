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
    'M-5',
    'residencial'::public.manzana_kind,
    'Oeste',
    $json$[[766,325],[856,325],[856,375],[766,375]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"9x10","frontB":"9x10","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[766,325],[776,325],[776,350],[766,350]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":true,"needs_review":true},{"number":"2","ring":[[776,325],[786,325],[786,350],[776,350]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"3","ring":[[786,325],[796,325],[796,350],[786,350]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"4","ring":[[796,325],[806,325],[806,350],[796,350]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"5","ring":[[806,325],[816,325],[816,350],[806,350]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"6","ring":[[816,325],[826,325],[826,350],[816,350]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"7","ring":[[826,325],[836,325],[836,350],[826,350]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"8","ring":[[836,325],[846,325],[846,350],[836,350]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"9","ring":[[846,325],[856,325],[856,350],[846,350]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":true,"needs_review":true},{"number":"10","ring":[[846,350],[856,350],[856,375],[846,375]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":true,"needs_review":true},{"number":"11","ring":[[836,350],[846,350],[846,375],[836,375]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"12","ring":[[826,350],[836,350],[836,375],[826,375]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"13","ring":[[816,350],[826,350],[826,375],[816,375]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"14","ring":[[806,350],[816,350],[816,375],[806,375]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"15","ring":[[796,350],[806,350],[806,375],[796,375]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"16","ring":[[786,350],[796,350],[796,375],[786,375]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"17","ring":[[776,350],[786,350],[786,375],[776,375]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"18","ring":[[766,350],[776,350],[776,375],[766,375]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-5 ok' as resultado;