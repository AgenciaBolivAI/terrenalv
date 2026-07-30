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
    'M-72',
    'residencial'::public.manzana_kind,
    'Oeste',
    $json$[[589,331],[589.44,328.22],[590.72,325.71],[592.71,323.72],[595.22,322.44],[598,322],[661,322],[663.78,322.44],[666.29,323.72],[668.28,325.71],[669.56,328.22],[670,331],[670,373],[669.56,375.78],[668.28,378.29],[666.29,380.28],[663.78,381.56],[661,382],[598,382],[595.22,381.56],[592.71,380.28],[590.72,378.29],[589.44,375.78],[589,373]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"12; 5x10; 12","frontB":"12; 5x10; 12","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[590.72,325.71],[592.71,323.72],[595.22,322.44],[598,322],[602.72,322],[602.72,352],[590.72,352]],"frontage_m":12,"depth_m":30,"area_m2":351.27,"is_corner":true,"needs_review":true},{"number":"2","ring":[[602.72,322],[612.72,322],[612.72,352],[602.72,352]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"3","ring":[[612.72,322],[622.72,322],[622.72,352],[612.72,352]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"4","ring":[[622.72,322],[632.72,322],[632.72,352],[622.72,352]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"5","ring":[[632.72,322],[642.72,322],[642.72,352],[632.72,352]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"6","ring":[[642.72,322],[652.72,322],[652.72,352],[642.72,352]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"7","ring":[[652.72,322],[661,322],[663.78,322.44],[664.72,322.92],[664.72,352],[652.72,352]],"frontage_m":12,"depth_m":30,"area_m2":358.75,"is_corner":true,"needs_review":true},{"number":"8","ring":[[656.28,352],[668.28,352],[668.28,378.29],[666.29,380.28],[663.78,381.56],[661,382],[656.28,382]],"frontage_m":12,"depth_m":30,"area_m2":351.27,"is_corner":true,"needs_review":true},{"number":"9","ring":[[646.28,352],[656.28,352],[656.28,382],[646.28,382]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"10","ring":[[636.28,352],[646.28,352],[646.28,382],[636.28,382]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"11","ring":[[626.28,352],[636.28,352],[636.28,382],[626.28,382]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"12","ring":[[616.28,352],[626.28,352],[626.28,382],[616.28,382]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"13","ring":[[606.28,352],[616.28,352],[616.28,382],[606.28,382]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"14","ring":[[594.28,352],[606.28,352],[606.28,382],[598,382],[595.22,381.56],[594.28,381.08]],"frontage_m":12,"depth_m":30,"area_m2":358.75,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-72 ok' as resultado;