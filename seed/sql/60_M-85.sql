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
    'M-85',
    'equipamiento'::public.manzana_kind,
    'Oeste',
    $json$[[0,95],[0.44,92.22],[1.72,89.71],[3.71,87.72],[6.22,86.44],[9,86],[135,86],[137.78,86.44],[140.29,87.72],[142.28,89.71],[143.56,92.22],[144,95],[144,137],[143.56,139.78],[142.28,142.29],[140.29,144.28],[137.78,145.56],[135,146],[9,146],[6.22,145.56],[3.71,144.28],[1.72,142.29],[0.44,139.78],[0,137]]$json$::jsonb,
    null
  ))->>'id')::uuid;

  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-85 ok' as resultado;