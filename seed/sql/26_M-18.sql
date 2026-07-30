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
    'M-18',
    'residencial'::public.manzana_kind,
    'Este',
    $json$[[2111.53,331],[2111.97,328.22],[2113.24,325.71],[2115.24,323.72],[2117.74,322.44],[2120.53,322],[2138.46,322],[2141.24,322.44],[2143.75,323.72],[2145.74,325.71],[2147.02,328.22],[2147.46,331],[2147.46,373],[2147.02,375.78],[2145.74,378.29],[2143.75,380.28],[2141.24,381.56],[2138.46,382],[2120.53,382],[2117.74,381.56],[2115.24,380.28],[2113.24,378.29],[2111.97,375.78],[2111.53,373]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"12; 1x10; 12","frontB":"12; 1x10; 12","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[2111.53,366.29],[2129.49,366.29],[2129.49,378.29],[2113.24,378.29],[2111.97,375.78],[2111.53,373]],"frontage_m":12,"depth_m":17.96,"area_m2":212.21,"is_corner":true,"needs_review":true},{"number":"2","ring":[[2111.53,356.29],[2129.49,356.29],[2129.49,366.29],[2111.53,366.29]],"frontage_m":10,"depth_m":17.96,"area_m2":179.6,"is_corner":false,"needs_review":true},{"number":"3","ring":[[2111.53,344.29],[2129.49,344.29],[2129.49,356.29],[2111.53,356.29]],"frontage_m":12,"depth_m":17.96,"area_m2":215.52,"is_corner":true,"needs_review":true},{"number":"4","ring":[[2129.49,323.72],[2143.75,323.72],[2145.74,325.71],[2147.02,328.22],[2147.46,331],[2147.46,335.72],[2129.49,335.72]],"frontage_m":12,"depth_m":17.97,"area_m2":206.91,"is_corner":true,"needs_review":true},{"number":"5","ring":[[2129.49,335.72],[2147.46,335.72],[2147.46,345.72],[2129.49,345.72]],"frontage_m":10,"depth_m":17.97,"area_m2":179.7,"is_corner":false,"needs_review":true},{"number":"6","ring":[[2129.49,345.72],[2147.46,345.72],[2147.46,357.72],[2129.49,357.72]],"frontage_m":12,"depth_m":17.97,"area_m2":215.64,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-18 ok' as resultado;