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
    'M-49',
    'equipamiento'::public.manzana_kind,
    'Centro',
    $json$[[1289.86,22],[1290.3,19.22],[1291.58,16.71],[1293.57,14.72],[1296.08,13.44],[1298.86,13],[1349.86,13],[1352.64,13.44],[1355.15,14.72],[1357.14,16.71],[1358.42,19.22],[1358.86,22],[1358.86,137],[1358.42,139.78],[1357.14,142.29],[1355.15,144.28],[1352.64,145.56],[1349.86,146],[1298.86,146],[1296.08,145.56],[1293.57,144.28],[1291.58,142.29],[1290.3,139.78],[1289.86,137]]$json$::jsonb,
    null
  ))->>'id')::uuid;

  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-49 ok' as resultado;