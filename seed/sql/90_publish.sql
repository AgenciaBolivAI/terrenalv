select set_config('request.jwt.claims', '{"role":"service_role"}', false);
do $seed$
declare v_project uuid; v_snapshot jsonb;
begin
  select id into v_project from public.projects where slug = 'prados-del-sur';
  v_snapshot := public.publish_geometry(v_project);
  raise notice 'published v%', v_snapshot->>'v';
end $seed$;
select p.geometry_version,
       (select count(*) from public.manzanas m where m.project_id = p.id) as manzanas,
       (select count(*) from public.lots l where l.project_id = p.id and l.deleted_at is null) as lotes,
       (select count(*) from public.map_elements e where e.project_id = p.id) as elementos
from public.projects p where p.slug = 'prados-del-sur';