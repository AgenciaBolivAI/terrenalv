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
    'M-17',
    'residencial'::public.manzana_kind,
    'Este',
    $json$[[2160.46,331],[2160.9,328.22],[2162.18,325.71],[2164.17,323.72],[2166.68,322.44],[2169.46,322],[2187.4,322],[2190.18,322.44],[2192.69,323.72],[2194.68,325.71],[2195.96,328.22],[2196.4,331],[2196.4,373],[2195.96,375.78],[2194.68,378.29],[2192.69,380.28],[2190.18,381.56],[2187.4,382],[2169.46,382],[2166.68,381.56],[2164.17,380.28],[2162.18,378.29],[2160.9,375.78],[2160.46,373]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"12; 1x10; 12","frontB":"12; 1x10; 12","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[2178.43,323.72],[2192.69,323.72],[2194.68,325.71],[2195.96,328.22],[2196.4,331],[2196.4,335.72],[2178.43,335.72]],"frontage_m":12,"depth_m":17.97,"area_m2":206.91,"is_corner":true,"needs_review":true},{"number":"2","ring":[[2178.43,335.72],[2196.4,335.72],[2196.4,345.72],[2178.43,345.72]],"frontage_m":10,"depth_m":17.97,"area_m2":179.7,"is_corner":false,"needs_review":true},{"number":"3","ring":[[2178.43,345.72],[2196.4,345.72],[2196.4,357.72],[2178.43,357.72]],"frontage_m":12,"depth_m":17.97,"area_m2":215.64,"is_corner":true,"needs_review":true},{"number":"4","ring":[[2160.46,366.29],[2178.43,366.29],[2178.43,378.29],[2162.18,378.29],[2160.9,375.78],[2160.46,373]],"frontage_m":12,"depth_m":17.97,"area_m2":212.32,"is_corner":true,"needs_review":true},{"number":"5","ring":[[2160.46,356.29],[2178.43,356.29],[2178.43,366.29],[2160.46,366.29]],"frontage_m":10,"depth_m":17.97,"area_m2":179.7,"is_corner":false,"needs_review":true},{"number":"6","ring":[[2160.46,344.29],[2178.43,344.29],[2178.43,356.29],[2160.46,356.29]],"frontage_m":12,"depth_m":17.97,"area_m2":215.64,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-17 ok' as resultado;