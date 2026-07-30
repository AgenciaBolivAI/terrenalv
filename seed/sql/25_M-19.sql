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
    'M-19',
    'residencial'::public.manzana_kind,
    'Este',
    $json$[[2062.59,331],[2063.03,328.22],[2064.31,325.71],[2066.3,323.72],[2068.81,322.44],[2071.59,322],[2089.53,322],[2092.31,322.44],[2094.82,323.72],[2096.81,325.71],[2098.09,328.22],[2098.53,331],[2098.53,373],[2098.09,375.78],[2096.81,378.29],[2094.82,380.28],[2092.31,381.56],[2089.53,382],[2071.59,382],[2068.81,381.56],[2066.3,380.28],[2064.31,378.29],[2063.03,375.78],[2062.59,373]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"12; 1x10; 12","frontB":"12; 1x10; 12","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[2062.59,366.29],[2080.56,366.29],[2080.56,378.29],[2064.31,378.29],[2063.03,375.78],[2062.59,373]],"frontage_m":12,"depth_m":17.97,"area_m2":212.32,"is_corner":true,"needs_review":true},{"number":"2","ring":[[2062.59,356.29],[2080.56,356.29],[2080.56,366.29],[2062.59,366.29]],"frontage_m":10,"depth_m":17.97,"area_m2":179.7,"is_corner":false,"needs_review":true},{"number":"3","ring":[[2062.59,344.29],[2080.56,344.29],[2080.56,356.29],[2062.59,356.29]],"frontage_m":12,"depth_m":17.97,"area_m2":215.64,"is_corner":true,"needs_review":true},{"number":"4","ring":[[2080.56,323.72],[2094.82,323.72],[2096.81,325.71],[2098.09,328.22],[2098.53,331],[2098.53,335.72],[2080.56,335.72]],"frontage_m":12,"depth_m":17.97,"area_m2":206.91,"is_corner":true,"needs_review":true},{"number":"5","ring":[[2080.56,335.72],[2098.53,335.72],[2098.53,345.72],[2080.56,345.72]],"frontage_m":10,"depth_m":17.97,"area_m2":179.7,"is_corner":false,"needs_review":true},{"number":"6","ring":[[2080.56,345.72],[2098.53,345.72],[2098.53,357.72],[2080.56,357.72]],"frontage_m":12,"depth_m":17.97,"area_m2":215.64,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-19 ok' as resultado;