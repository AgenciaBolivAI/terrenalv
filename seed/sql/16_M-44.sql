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
    'M-44',
    'residencial'::public.manzana_kind,
    'Centro',
    $json$[[1574.44,331],[1574.88,328.22],[1576.16,325.71],[1578.15,323.72],[1580.66,322.44],[1583.44,322],[1607.11,322],[1609.89,322.44],[1612.4,323.72],[1614.39,325.71],[1615.67,328.22],[1616.11,331],[1616.11,373],[1615.67,375.78],[1614.39,378.29],[1612.4,380.28],[1609.89,381.56],[1607.11,382],[1583.44,382],[1580.66,381.56],[1578.15,380.28],[1576.16,378.29],[1574.88,375.78],[1574.44,373]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"12; 1x10; 12","frontB":"12; 1x10; 12","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[1595.28,325.71],[1614.39,325.71],[1615.67,328.22],[1616.11,331],[1616.11,337.71],[1595.28,337.71]],"frontage_m":12,"depth_m":20.83,"area_m2":246.64,"is_corner":true,"needs_review":true},{"number":"2","ring":[[1595.28,337.71],[1616.11,337.71],[1616.11,347.71],[1595.28,347.71]],"frontage_m":10,"depth_m":20.83,"area_m2":208.3,"is_corner":false,"needs_review":true},{"number":"3","ring":[[1595.28,347.71],[1616.11,347.71],[1616.11,359.71],[1595.28,359.71]],"frontage_m":12,"depth_m":20.83,"area_m2":249.96,"is_corner":true,"needs_review":true},{"number":"4","ring":[[1574.44,366.29],[1595.28,366.29],[1595.28,378.29],[1576.16,378.29],[1574.88,375.78],[1574.44,373]],"frontage_m":12,"depth_m":20.84,"area_m2":246.76,"is_corner":true,"needs_review":true},{"number":"5","ring":[[1574.44,356.29],[1595.28,356.29],[1595.28,366.29],[1574.44,366.29]],"frontage_m":10,"depth_m":20.84,"area_m2":208.4,"is_corner":false,"needs_review":true},{"number":"6","ring":[[1574.44,344.29],[1595.28,344.29],[1595.28,356.29],[1574.44,356.29]],"frontage_m":12,"depth_m":20.84,"area_m2":250.08,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-44 ok' as resultado;