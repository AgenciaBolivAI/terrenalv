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
    'M-78',
    'residencial'::public.manzana_kind,
    'Oeste',
    $json$[[444,168],[444.44,165.22],[445.72,162.71],[447.71,160.72],[450.22,159.44],[453,159],[503,159],[505.78,159.44],[508.29,160.72],[510.28,162.71],[511.56,165.22],[512,168],[512,210],[511.56,212.78],[510.28,215.29],[508.29,217.28],[505.78,218.56],[503,219],[453,219],[450.22,218.56],[447.71,217.28],[445.72,215.29],[444.44,212.78],[444,210]]$json$::jsonb,
    $json${"rows":2,"depthA":null,"frontA":"12; 4x10; 12","frontB":"12; 4x10; 12","hint":"S"}$json$::jsonb
  ))->>'id')::uuid;
  perform public.save_lots(v_id, $json$[{"number":"1","ring":[[447.71,160.72],[450.22,159.44],[453,159],[459.71,159],[459.71,189],[447.71,189]],"frontage_m":12,"depth_m":30,"area_m2":356.68,"is_corner":true,"needs_review":true},{"number":"2","ring":[[459.71,159],[469.71,159],[469.71,189],[459.71,189]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"3","ring":[[469.71,159],[479.71,159],[479.71,189],[469.71,189]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"4","ring":[[479.71,159],[489.71,159],[489.71,189],[479.71,189]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"5","ring":[[489.71,159],[499.71,159],[499.71,189],[489.71,189]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"6","ring":[[499.71,159],[503,159],[505.78,159.44],[508.29,160.72],[510.28,162.71],[511.56,165.22],[511.71,166.17],[511.71,189],[499.71,189]],"frontage_m":12,"depth_m":30,"area_m2":343.92,"is_corner":true,"needs_review":true},{"number":"7","ring":[[496.29,189],[508.29,189],[508.29,217.28],[505.78,218.56],[503,219],[496.29,219]],"frontage_m":12,"depth_m":30,"area_m2":356.68,"is_corner":true,"needs_review":true},{"number":"8","ring":[[486.29,189],[496.29,189],[496.29,219],[486.29,219]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"9","ring":[[476.29,189],[486.29,189],[486.29,219],[476.29,219]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"10","ring":[[466.29,189],[476.29,189],[476.29,219],[466.29,219]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"11","ring":[[456.29,189],[466.29,189],[466.29,219],[456.29,219]],"frontage_m":10,"depth_m":30,"area_m2":300,"is_corner":false,"needs_review":true},{"number":"12","ring":[[444.29,189],[456.29,189],[456.29,219],[453,219],[450.22,218.56],[447.71,217.28],[445.72,215.29],[444.44,212.78],[444.29,211.83]],"frontage_m":12,"depth_m":30,"area_m2":343.92,"is_corner":true,"needs_review":true}]$json$::jsonb, false);
  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-78 ok' as resultado;