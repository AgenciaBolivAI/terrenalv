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
    'M-79',
    'equipamiento'::public.manzana_kind,
    'Oeste',
    $json$[[497,258],[497.44,255.22],[498.72,252.71],[500.71,250.72],[503.22,249.44],[506,249],[567,249],[569.78,249.44],[572.29,250.72],[574.28,252.71],[575.56,255.22],[576,258],[576,373],[575.56,375.78],[574.28,378.29],[572.29,380.28],[569.78,381.56],[567,382],[506,382],[503.22,381.56],[500.71,380.28],[498.72,378.29],[497.44,375.78],[497,373]]$json$::jsonb,
    null
  ))->>'id')::uuid;

  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-79 ok' as resultado;