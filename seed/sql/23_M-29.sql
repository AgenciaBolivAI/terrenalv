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
    'M-29',
    'residencial'::public.manzana_kind,
    'Este',
    $json$[[1964.71,331],[1965.16,328.22],[1966.43,325.71],[1968.42,323.72],[1970.93,322.44],[1973.71,322],[1991.65,322],[1994.43,322.44],[1996.94,323.72],[1998.93,325.71],[2000.21,328.22],[2000.65,331],[2000.65,373],[2000.21,375.78],[1998.93,378.29],[1996.94,380.28],[1994.43,381.56],[1991.65,382],[1973.71,382],[1970.93,381.56],[1968.42,380.28],[1966.43,378.29],[1965.16,375.78],[1964.71,373]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"12; 1x10; 12","frontB":"12; 1x10; 12","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[1982.68,325.71],[1998.93,325.71],[2000.21,328.22],[2000.65,331],[2000.65,337.71],[1982.68,337.71]],"frontage_m":12,"depth_m":17.97,"area_m2":212.32,"is_corner":true,"needs_review":true},{"number":"2","ring":[[1982.68,337.71],[2000.65,337.71],[2000.65,347.71],[1982.68,347.71]],"frontage_m":10,"depth_m":17.97,"area_m2":179.7,"is_corner":false,"needs_review":true},{"number":"3","ring":[[1982.68,347.71],[2000.65,347.71],[2000.65,359.71],[1982.68,359.71]],"frontage_m":12,"depth_m":17.97,"area_m2":215.64,"is_corner":true,"needs_review":true},{"number":"4","ring":[[1964.71,366.29],[1982.68,366.29],[1982.68,378.29],[1966.43,378.29],[1965.16,375.78],[1964.71,373]],"frontage_m":12,"depth_m":17.97,"area_m2":212.29,"is_corner":true,"needs_review":true},{"number":"5","ring":[[1964.71,356.29],[1982.68,356.29],[1982.68,366.29],[1964.71,366.29]],"frontage_m":10,"depth_m":17.97,"area_m2":179.7,"is_corner":false,"needs_review":true},{"number":"6","ring":[[1964.71,344.29],[1982.68,344.29],[1982.68,356.29],[1964.71,356.29]],"frontage_m":12,"depth_m":17.97,"area_m2":215.64,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-29 ok' as resultado;