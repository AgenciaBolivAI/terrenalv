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
    'M-6',
    'residencial'::public.manzana_kind,
    'Oeste',
    $json$[[663,325],[753,325],[753,375],[663,375]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"9x10","frontB":"9x10","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[663,325],[673,325],[673,350],[663,350]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":true,"needs_review":true},{"number":"2","ring":[[673,325],[683,325],[683,350],[673,350]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"3","ring":[[683,325],[693,325],[693,350],[683,350]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"4","ring":[[693,325],[703,325],[703,350],[693,350]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"5","ring":[[703,325],[713,325],[713,350],[703,350]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"6","ring":[[713,325],[723,325],[723,350],[713,350]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"7","ring":[[723,325],[733,325],[733,350],[723,350]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"8","ring":[[733,325],[743,325],[743,350],[733,350]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"9","ring":[[743,325],[753,325],[753,350],[743,350]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":true,"needs_review":true},{"number":"10","ring":[[743,350],[753,350],[753,375],[743,375]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":true,"needs_review":true},{"number":"11","ring":[[733,350],[743,350],[743,375],[733,375]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"12","ring":[[723,350],[733,350],[733,375],[723,375]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"13","ring":[[713,350],[723,350],[723,375],[713,375]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"14","ring":[[703,350],[713,350],[713,375],[703,375]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"15","ring":[[693,350],[703,350],[703,375],[693,375]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"16","ring":[[683,350],[693,350],[693,375],[683,375]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"17","ring":[[673,350],[683,350],[683,375],[673,375]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"18","ring":[[663,350],[673,350],[673,375],[663,375]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-6 ok' as resultado;