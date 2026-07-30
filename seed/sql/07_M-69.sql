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
    'M-69',
    'residencial'::public.manzana_kind,
    'Centro',
    $json$[[896,331],[896.44,328.22],[897.72,325.71],[899.71,323.72],[902.22,322.44],[905,322],[975,322],[977.78,322.44],[980.29,323.72],[982.28,325.71],[983.56,328.22],[984,331],[984,373],[983.56,375.78],[982.28,378.29],[980.29,380.28],[977.78,381.56],[975,382],[905,382],[902.22,381.56],[899.71,380.28],[897.72,378.29],[896.44,375.78],[896,373]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"12; 6x10; 12","frontB":"12; 6x10; 12","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[897.72,325.71],[899.71,323.72],[902.22,322.44],[905,322],[909.72,322],[909.72,352],[897.72,352]],"frontage_m":12,"depth_m":30,"area_m2":351.27,"is_corner":true,"needs_review":true},{"number":"2","ring":[[909.72,322],[919.72,322],[919.72,352],[909.72,352]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"3","ring":[[919.72,322],[929.72,322],[929.72,352],[919.72,352]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"4","ring":[[929.72,322],[939.72,322],[939.72,352],[929.72,352]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"5","ring":[[939.72,322],[949.72,322],[949.72,352],[939.72,352]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"6","ring":[[949.72,322],[959.72,322],[959.72,352],[949.72,352]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"7","ring":[[959.72,322],[969.72,322],[969.72,352],[959.72,352]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"8","ring":[[969.72,322],[975,322],[977.78,322.44],[980.29,323.72],[981.72,325.15],[981.72,352],[969.72,352]],"frontage_m":12,"depth_m":30,"area_m2":353.2,"is_corner":true,"needs_review":true},{"number":"9","ring":[[970.28,352],[982.28,352],[982.28,378.29],[980.29,380.28],[977.78,381.56],[975,382],[970.28,382]],"frontage_m":12,"depth_m":30,"area_m2":351.27,"is_corner":true,"needs_review":true},{"number":"10","ring":[[960.28,352],[970.28,352],[970.28,382],[960.28,382]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"11","ring":[[950.28,352],[960.28,352],[960.28,382],[950.28,382]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"12","ring":[[940.28,352],[950.28,352],[950.28,382],[940.28,382]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"13","ring":[[930.28,352],[940.28,352],[940.28,382],[930.28,382]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"14","ring":[[920.28,352],[930.28,352],[930.28,382],[920.28,382]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"15","ring":[[910.28,352],[920.28,352],[920.28,382],[910.28,382]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"16","ring":[[898.28,352],[910.28,352],[910.28,382],[905,382],[902.22,381.56],[899.71,380.28],[898.28,378.85]],"frontage_m":12,"depth_m":30,"area_m2":353.2,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-69 ok' as resultado;