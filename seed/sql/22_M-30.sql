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
    'M-30',
    'residencial'::public.manzana_kind,
    'Este',
    $json$[[1915.78,331],[1916.22,328.22],[1917.5,325.71],[1919.49,323.72],[1922,322.44],[1924.78,322],[1942.71,322],[1945.5,322.44],[1948,323.72],[1950,325.71],[1951.27,328.22],[1951.71,331],[1951.71,373],[1951.27,375.78],[1950,378.29],[1948,380.28],[1945.5,381.56],[1942.71,382],[1924.78,382],[1922,381.56],[1919.49,380.28],[1917.5,378.29],[1916.22,375.78],[1915.78,373]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"12; 1x10; 12","frontB":"12; 1x10; 12","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[1933.74,325.71],[1950,325.71],[1951.27,328.22],[1951.71,331],[1951.71,337.71],[1933.74,337.71]],"frontage_m":12,"depth_m":17.97,"area_m2":212.33,"is_corner":true,"needs_review":true},{"number":"2","ring":[[1933.74,337.71],[1951.71,337.71],[1951.71,347.71],[1933.74,347.71]],"frontage_m":10,"depth_m":17.97,"area_m2":179.7,"is_corner":false,"needs_review":true},{"number":"3","ring":[[1933.74,347.71],[1951.71,347.71],[1951.71,359.71],[1933.74,359.71]],"frontage_m":12,"depth_m":17.97,"area_m2":215.64,"is_corner":true,"needs_review":true},{"number":"4","ring":[[1915.78,366.29],[1933.74,366.29],[1933.74,378.29],[1917.5,378.29],[1916.22,375.78],[1915.78,373]],"frontage_m":12,"depth_m":17.96,"area_m2":212.2,"is_corner":true,"needs_review":true},{"number":"5","ring":[[1915.78,356.29],[1933.74,356.29],[1933.74,366.29],[1915.78,366.29]],"frontage_m":10,"depth_m":17.96,"area_m2":179.6,"is_corner":false,"needs_review":true},{"number":"6","ring":[[1915.78,344.29],[1933.74,344.29],[1933.74,356.29],[1915.78,356.29]],"frontage_m":12,"depth_m":17.96,"area_m2":215.52,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-30 ok' as resultado;