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
    'M-77',
    'area_verde'::public.manzana_kind,
    'Oeste',
    $json$[[314,22],[314.44,19.22],[315.72,16.71],[317.71,14.72],[320.22,13.44],[323,13],[474,13],[476.78,13.44],[479.29,14.72],[481.28,16.71],[482.56,19.22],[483,22],[483,137],[482.56,139.78],[481.28,142.29],[479.29,144.28],[476.78,145.56],[474,146],[323,146],[320.22,145.56],[317.71,144.28],[315.72,142.29],[314.44,139.78],[314,137]]$json$::jsonb,
    null
  ))->>'id')::uuid;

  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-77 ok' as resultado;