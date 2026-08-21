-- The public map reads its geometry from a CDN-cached Storage snapshot written
-- at publish time. That upload needs the service key, so a freshly published
-- version is unreachable until someone runs the seed script — the map would
-- render "Mapa en preparación" despite the geometry being live in the tables.
--
-- This RPC serves the SAME shape straight from the published rows, so Storage
-- becomes a pure cache: present → fast path, absent → correct fallback.
create or replace function public.get_geometry_snapshot(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_version int;
  v_bbox extensions.box2d;
begin
  select geometry_version into v_version
  from public.projects
  where id = p_project_id and status = 'activo';
  if v_version is null or v_version < 1 then
    return null;
  end if;

  select extensions.st_extent(geom) into v_bbox
  from public.manzanas
  where project_id = p_project_id and state = 'published' and geom is not null;
  if v_bbox is null then
    return null;
  end if;

  return jsonb_build_object(
    'v', v_version,
    'bbox', jsonb_build_array(
      extensions.st_xmin(v_bbox), extensions.st_ymin(v_bbox),
      extensions.st_xmax(v_bbox), extensions.st_ymax(v_bbox)),
    'manzanas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'code', m.code, 'kind', m.kind, 'sector', m.sector,
        'needs_review', m.needs_review,
        'ring', (extensions.st_asgeojson(m.geom, 2)::jsonb)->'coordinates'->0
      ) order by m.code)
      from public.manzanas m
      where m.project_id = p_project_id and m.state = 'published' and m.geom is not null
    ), '[]'::jsonb),
    'lots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'mz', l.manzana_id, 'n', l.number,
        'f', l.frontage_m, 'd', l.depth_m, 'a', l.area_m2, 'corner', l.is_corner,
        'ring', (extensions.st_asgeojson(l.geom, 2)::jsonb)->'coordinates'->0
      ) order by l.manzana_id, l.number)
      from public.lots l
      where l.project_id = p_project_id and l.state = 'published' and l.deleted_at is null
    ), '[]'::jsonb),
    'elements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'kind', e.kind, 'name', e.name, 'props', e.props,
        'geojson', extensions.st_asgeojson(e.geom, 2)::jsonb
      ))
      from public.map_elements e
      where e.project_id = p_project_id and e.state = 'published'
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.get_geometry_snapshot(uuid) from public;
grant execute on function public.get_geometry_snapshot(uuid) to anon, authenticated, service_role;
