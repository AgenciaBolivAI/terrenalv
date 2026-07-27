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
    'M-7',
    'residencial'::public.manzana_kind,
    'Oeste',
    $json$[[663,262],[753,262],[753,312],[663,312]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"9x10","frontB":"9x10","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[663,262],[673,262],[673,287],[663,287]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":true,"needs_review":true},{"number":"2","ring":[[673,262],[683,262],[683,287],[673,287]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"3","ring":[[683,262],[693,262],[693,287],[683,287]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"4","ring":[[693,262],[703,262],[703,287],[693,287]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"5","ring":[[703,262],[713,262],[713,287],[703,287]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"6","ring":[[713,262],[723,262],[723,287],[713,287]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"7","ring":[[723,262],[733,262],[733,287],[723,287]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"8","ring":[[733,262],[743,262],[743,287],[733,287]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"9","ring":[[743,262],[753,262],[753,287],[743,287]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":true,"needs_review":true},{"number":"10","ring":[[743,287],[753,287],[753,312],[743,312]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":true,"needs_review":true},{"number":"11","ring":[[733,287],[743,287],[743,312],[733,312]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"12","ring":[[723,287],[733,287],[733,312],[723,312]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"13","ring":[[713,287],[723,287],[723,312],[713,312]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"14","ring":[[703,287],[713,287],[713,312],[703,312]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"15","ring":[[693,287],[703,287],[703,312],[693,312]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"16","ring":[[683,287],[693,287],[693,312],[683,312]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"17","ring":[[673,287],[683,287],[683,312],[673,312]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":false,"needs_review":true},{"number":"18","ring":[[663,287],[673,287],[673,312],[663,312]],"frontage_m":10,"depth_m":25,"area_m2":250,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-7 ok' as resultado;