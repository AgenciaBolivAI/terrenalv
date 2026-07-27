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
    'M-20',
    'area_verde'::public.manzana_kind,
    'Sur',
    $json$[[341,490],[341.44,487.22],[342.72,484.71],[344.71,482.72],[347.22,481.44],[350,481],[382,481],[384.78,481.44],[387.29,482.72],[389.28,484.71],[390.56,487.22],[391,490],[391,649.5],[390.56,652.28],[389.28,654.79],[387.29,656.78],[384.78,658.06],[382,658.5],[350,658.5],[347.22,658.06],[344.71,656.78],[342.72,654.79],[341.44,652.28],[341,649.5]]$json$::jsonb,
    null
  ))->>'id')::uuid;

  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-20 ok' as resultado;