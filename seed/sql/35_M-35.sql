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
    'M-35',
    'equipamiento'::public.manzana_kind,
    'Sur',
    $json$[[139,1061.5],[139.44,1058.72],[140.72,1056.21],[142.71,1054.22],[145.22,1052.94],[148,1052.5],[180,1052.5],[182.78,1052.94],[185.29,1054.22],[187.28,1056.21],[188.56,1058.72],[189,1061.5],[189,1221],[188.56,1223.78],[187.28,1226.29],[185.29,1228.28],[182.78,1229.56],[180,1230],[148,1230],[145.22,1229.56],[142.71,1228.28],[140.72,1226.29],[139.44,1223.78],[139,1221]]$json$::jsonb,
    null
  ))->>'id')::uuid;

  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-35 ok' as resultado;