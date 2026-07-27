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
    'M-90',
    'area_verde'::public.manzana_kind,
    'Norte',
    $json$[[215,2776],[215.44,2773.22],[216.72,2770.71],[218.71,2768.72],[221.22,2767.44],[224,2767],[256,2767],[258.78,2767.44],[261.29,2768.72],[263.28,2770.71],[264.56,2773.22],[265,2776],[265,2935.5],[264.56,2938.28],[263.28,2940.79],[261.29,2942.78],[258.78,2944.06],[256,2944.5],[224,2944.5],[221.22,2944.06],[218.71,2942.78],[216.72,2940.79],[215.44,2938.28],[215,2935.5]]$json$::jsonb,
    null
  ))->>'id')::uuid;

  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-90 ok' as resultado;