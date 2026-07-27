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
    'M-58',
    'equipamiento'::public.manzana_kind,
    'Norte',
    $json$[[209,1801],[379,1801],[379,1851],[209,1851]]$json$::jsonb,
    null
  ))->>'id')::uuid;

  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-58 ok' as resultado;