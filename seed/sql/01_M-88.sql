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
    'M-88',
    'area_verde'::public.manzana_kind,
    'Oeste',
    $json$[[0,331],[0.44,328.22],[1.72,325.71],[3.71,323.72],[6.22,322.44],[9,322],[210,322],[212.78,322.44],[215.29,323.72],[217.28,325.71],[218.56,328.22],[219,331],[219,373],[218.56,375.78],[217.28,378.29],[215.29,380.28],[212.78,381.56],[210,382],[9,382],[6.22,381.56],[3.71,380.28],[1.72,378.29],[0.44,375.78],[0,373]]$json$::jsonb,
    null
  ))->>'id')::uuid;

  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-88 ok' as resultado;