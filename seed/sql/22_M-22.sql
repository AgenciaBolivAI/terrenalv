select set_config('request.jwt.claims', '{"role":"service_role"}', false);
do $seed$
declare
  v_project uuid;
  v_id uuid;
begin
  select id into v_project from public.projects where slug = 'estrellas-del-sur';
  if v_project is null then raise exception 'proyecto no encontrado'; end if;
  v_id := ((public.save_manzana(
    v_project,
    'M-22',
    'amenidad'::public.manzana_kind,
    'Sur',
    $json$[[76,680.5],[76.44,677.72],[77.72,675.21],[79.71,673.22],[82.22,671.94],[85,671.5],[117,671.5],[119.78,671.94],[122.29,673.22],[124.28,675.21],[125.56,677.72],[126,680.5],[126,840],[125.56,842.78],[124.28,845.29],[122.29,847.28],[119.78,848.56],[117,849],[85,849],[82.22,848.56],[79.71,847.28],[77.72,845.29],[76.44,842.78],[76,840]]$json$::jsonb,
    null
  ))->>'id')::uuid;

  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-22 ok' as resultado;