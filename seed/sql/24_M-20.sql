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
    'M-20',
    'residencial'::public.manzana_kind,
    'Este',
    $json$[[2013.65,331],[2014.09,328.22],[2015.37,325.71],[2017.36,323.72],[2019.87,322.44],[2022.65,322],[2040.59,322],[2043.37,322.44],[2045.88,323.72],[2047.87,325.71],[2049.15,328.22],[2049.59,331],[2049.59,373],[2049.15,375.78],[2047.87,378.29],[2045.88,380.28],[2043.37,381.56],[2040.59,382],[2022.65,382],[2019.87,381.56],[2017.36,380.28],[2015.37,378.29],[2014.09,375.78],[2013.65,373]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"12; 1x10; 12","frontB":"12; 1x10; 12","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[2031.62,323.72],[2045.88,323.72],[2047.87,325.71],[2049.15,328.22],[2049.59,331],[2049.59,335.72],[2031.62,335.72]],"frontage_m":12,"depth_m":17.97,"area_m2":206.91,"is_corner":true,"needs_review":true},{"number":"2","ring":[[2031.62,335.72],[2049.59,335.72],[2049.59,345.72],[2031.62,345.72]],"frontage_m":10,"depth_m":17.97,"area_m2":179.7,"is_corner":false,"needs_review":true},{"number":"3","ring":[[2031.62,345.72],[2049.59,345.72],[2049.59,357.72],[2031.62,357.72]],"frontage_m":12,"depth_m":17.97,"area_m2":215.64,"is_corner":true,"needs_review":true},{"number":"4","ring":[[2013.65,366.29],[2031.62,366.29],[2031.62,378.29],[2015.37,378.29],[2014.09,375.78],[2013.65,373]],"frontage_m":12,"depth_m":17.97,"area_m2":212.32,"is_corner":true,"needs_review":true},{"number":"5","ring":[[2013.65,356.29],[2031.62,356.29],[2031.62,366.29],[2013.65,366.29]],"frontage_m":10,"depth_m":17.97,"area_m2":179.7,"is_corner":false,"needs_review":true},{"number":"6","ring":[[2013.65,344.29],[2031.62,344.29],[2031.62,356.29],[2013.65,356.29]],"frontage_m":12,"depth_m":17.97,"area_m2":215.64,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-20 ok' as resultado;