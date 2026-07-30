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
    'M-67',
    'equipamiento'::public.manzana_kind,
    'Centro',
    $json$[[1104,258],[1104.44,255.22],[1105.72,252.71],[1107.71,250.72],[1110.22,249.44],[1113,249],[1178,249],[1180.78,249.44],[1183.29,250.72],[1185.28,252.71],[1186.56,255.22],[1187,258],[1187,373],[1186.56,375.78],[1185.28,378.29],[1183.29,380.28],[1180.78,381.56],[1178,382],[1113,382],[1110.22,381.56],[1107.71,380.28],[1105.72,378.29],[1104.44,375.78],[1104,373]]$json$::jsonb,
    null
  ))->>'id')::uuid;

  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-67 ok' as resultado;