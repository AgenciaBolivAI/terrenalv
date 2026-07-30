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
    'M-54',
    'area_verde'::public.manzana_kind,
    'Centro',
    $json$[[1390.11,258],[1390.55,255.22],[1391.83,252.71],[1393.82,250.72],[1396.33,249.44],[1399.11,249],[1443.11,249],[1445.89,249.44],[1448.4,250.72],[1450.39,252.71],[1451.67,255.22],[1452.11,258],[1452.11,373],[1451.67,375.78],[1450.39,378.29],[1448.4,380.28],[1445.89,381.56],[1443.11,382],[1399.11,382],[1396.33,381.56],[1393.82,380.28],[1391.83,378.29],[1390.55,375.78],[1390.11,373]]$json$::jsonb,
    null
  ))->>'id')::uuid;

  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-54 ok' as resultado;