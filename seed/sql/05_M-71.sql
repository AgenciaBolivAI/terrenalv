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
    'M-71',
    'residencial'::public.manzana_kind,
    'Oeste',
    $json$[[683,331],[683.44,328.22],[684.72,325.71],[686.71,323.72],[689.22,322.44],[692,322],[757,322],[759.78,322.44],[762.29,323.72],[764.28,325.71],[765.56,328.22],[766,331],[766,373],[765.56,375.78],[764.28,378.29],[762.29,380.28],[759.78,381.56],[757,382],[692,382],[689.22,381.56],[686.71,380.28],[684.72,378.29],[683.44,375.78],[683,373]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"12; 5x10; 12","frontB":"12; 5x10; 12","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[684.72,325.71],[686.71,323.72],[689.22,322.44],[692,322],[696.72,322],[696.72,352],[684.72,352]],"frontage_m":12,"depth_m":30,"area_m2":351.27,"is_corner":true,"needs_review":true},{"number":"2","ring":[[696.72,322],[706.72,322],[706.72,352],[696.72,352]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"3","ring":[[706.72,322],[716.72,322],[716.72,352],[706.72,352]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"4","ring":[[716.72,322],[726.72,322],[726.72,352],[716.72,352]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"5","ring":[[726.72,322],[736.72,322],[736.72,352],[726.72,352]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"6","ring":[[736.72,322],[746.72,322],[746.72,352],[736.72,352]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"7","ring":[[746.72,322],[757,322],[758.72,322.27],[758.72,352],[746.72,352]],"frontage_m":12,"depth_m":30,"area_m2":359.77,"is_corner":true,"needs_review":true},{"number":"8","ring":[[752.28,352],[764.28,352],[764.28,378.29],[762.29,380.28],[759.78,381.56],[757,382],[752.28,382]],"frontage_m":12,"depth_m":30,"area_m2":351.27,"is_corner":true,"needs_review":true},{"number":"9","ring":[[742.28,352],[752.28,352],[752.28,382],[742.28,382]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"10","ring":[[732.28,352],[742.28,352],[742.28,382],[732.28,382]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"11","ring":[[722.28,352],[732.28,352],[732.28,382],[722.28,382]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"12","ring":[[712.28,352],[722.28,352],[722.28,382],[712.28,382]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"13","ring":[[702.28,352],[712.28,352],[712.28,382],[702.28,382]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"14","ring":[[690.28,352],[702.28,352],[702.28,382],[692,382],[690.28,381.73]],"frontage_m":12,"depth_m":30,"area_m2":359.77,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-71 ok' as resultado;