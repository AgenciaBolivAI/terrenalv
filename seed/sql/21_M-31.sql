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
    'M-31',
    'equipamiento'::public.manzana_kind,
    'Este',
    $json$[[1847.78,258],[1848.22,255.22],[1849.5,252.71],[1851.49,250.72],[1854,249.44],[1856.78,249],[1893.78,249],[1896.56,249.44],[1899.07,250.72],[1901.06,252.71],[1902.34,255.22],[1902.78,258],[1902.78,373],[1902.34,375.78],[1901.06,378.29],[1899.07,380.28],[1896.56,381.56],[1893.78,382],[1856.78,382],[1854,381.56],[1851.49,380.28],[1849.5,378.29],[1848.22,375.78],[1847.78,373]]$json$::jsonb,
    null
  ))->>'id')::uuid;

  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-31 ok' as resultado;