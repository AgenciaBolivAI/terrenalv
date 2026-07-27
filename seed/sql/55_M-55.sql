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
    'M-55',
    'amenidad'::public.manzana_kind,
    'Norte',
    $json$[[278,1633],[278.44,1630.22],[279.72,1627.71],[281.71,1625.72],[284.22,1624.44],[287,1624],[319,1624],[321.78,1624.44],[324.29,1625.72],[326.28,1627.71],[327.56,1630.22],[328,1633],[328,1792.5],[327.56,1795.28],[326.28,1797.79],[324.29,1799.78],[321.78,1801.06],[319,1801.5],[287,1801.5],[284.22,1801.06],[281.71,1799.78],[279.72,1797.79],[278.44,1795.28],[278,1792.5]]$json$::jsonb,
    null
  ))->>'id')::uuid;

  update public.manzanas set needs_review = true where id = v_id;
end $seed$;
select 'M-55 ok' as resultado;