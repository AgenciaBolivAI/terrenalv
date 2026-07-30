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
    'M-16',
    'area_verde'::public.manzana_kind,
    'Este',
    $json$[[2209.4,258],[2209.84,255.22],[2211.12,252.71],[2213.11,250.72],[2215.62,249.44],[2218.4,249],[2254.4,249],[2257.18,249.44],[2259.69,250.72],[2261.68,252.71],[2262.96,255.22],[2263.4,258],[2263.4,373],[2262.96,375.78],[2261.68,378.29],[2259.69,380.28],[2257.18,381.56],[2254.4,382],[2218.4,382],[2215.62,381.56],[2213.11,380.28],[2211.12,378.29],[2209.84,375.78],[2209.4,373]]$json$::jsonb,
    null
  ))->>'id')::uuid;

  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-16 ok' as resultado;