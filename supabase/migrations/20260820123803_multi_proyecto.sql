create or replace function public.admin_create_project(
  p_name text,
  p_slug text,
  p_location text default null,
  p_currency char(3) default 'BOB',
  p_tracking_prefix text default null,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid;
  v_slug text;
  v_prefix text;
  v_id uuid;
begin
  v_actor := private.assert_admin();

  if btrim(coalesce(p_name, '')) = '' then raise exception 'NAME_REQUIRED'; end if;

  v_slug := lower(btrim(coalesce(nullif(btrim(p_slug), ''), p_name)));
  v_slug := translate(v_slug, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN');
  v_slug := regexp_replace(v_slug, '[^a-z0-9]+', '-', 'g');
  v_slug := btrim(v_slug, '-');
  if v_slug = '' then raise exception 'INVALID_SLUG'; end if;
  if exists (select 1 from public.projects where slug = v_slug) then
    raise exception 'SLUG_TAKEN';
  end if;

  v_prefix := upper(regexp_replace(coalesce(nullif(btrim(p_tracking_prefix), ''),
                    substr(regexp_replace(v_slug, '[^a-z]', '', 'g'), 1, 3)), '[^A-Z0-9]', '', 'g'));
  if length(v_prefix) < 2 then v_prefix := 'PRY'; end if;
  if exists (select 1 from public.projects where upper(tracking_prefix) = v_prefix) then
    raise exception 'PREFIX_TAKEN';
  end if;

  insert into public.projects
    (slug, name, description, location_text, status, currency, tracking_prefix, utm_epsg)
  values
    (v_slug, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''),
     nullif(btrim(coalesce(p_location, '')), ''),
     'borrador',
     coalesce(p_currency, 'BOB'), v_prefix, 32720)
  returning id into v_id;

  insert into public.pricing_categories (project_id, code, name, color_hex, price_per_m2, sort_order)
  values
    (v_id, 'A', 'Categoría A', '#F97316', 0, 1),
    (v_id, 'B', 'Categoría B', '#22C55E', 0, 2),
    (v_id, 'C', 'Categoría C', '#FACC15', 0, 3),
    (v_id, 'D', 'Categoría D', '#38BDF8', 0, 4),
    (v_id, 'E', 'Categoría E', '#A78BFA', 0, 5);

  perform private.audit('team', v_actor, null, 'project.created', v_id,
    'project', v_id, null,
    jsonb_build_object('slug', v_slug, 'nombre', btrim(p_name), 'prefijo', v_prefix));

  return jsonb_build_object('project_id', v_id, 'slug', v_slug, 'tracking_prefix', v_prefix);
end;
$fn$;

create or replace function public.admin_set_project_status(p_project_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid;
  v_before text;
  v_lotes int;
begin
  v_actor := private.assert_admin();
  if p_status not in ('activo', 'borrador', 'archivado') then raise exception 'INVALID_STATUS'; end if;

  select status into v_before from public.projects where id = p_project_id;
  if v_before is null then raise exception 'PROJECT_NOT_FOUND'; end if;

  if p_status = 'activo' then
    select count(*) into v_lotes from public.lots
     where project_id = p_project_id and deleted_at is null and state = 'published';
    if v_lotes = 0 then raise exception 'NO_PUBLISHED_LOTS'; end if;
  end if;

  update public.projects set status = p_status, updated_at = now() where id = p_project_id;

  perform private.audit('team', v_actor, null, 'project.status', p_project_id,
    'project', p_project_id,
    jsonb_build_object('status', v_before), jsonb_build_object('status', p_status));

  return jsonb_build_object('ok', true, 'status', p_status);
end;
$fn$;

revoke execute on function
  public.admin_create_project(text, text, text, char, text, text),
  public.admin_set_project_status(uuid, text)
from public, anon;

grant execute on function
  public.admin_create_project(text, text, text, char, text, text),
  public.admin_set_project_status(uuid, text)
to authenticated, service_role;

create or replace view public.v_proyectos
with (security_invoker = on) as
select
  p.id,
  p.slug,
  p.name,
  p.status,
  p.currency,
  p.tracking_prefix,
  p.location_text,
  p.geometry_version,
  p.created_at,
  count(distinct m.id)                                        as manzanas,
  count(l.id) filter (where l.deleted_at is null)              as lotes,
  count(l.id) filter (where l.deleted_at is null and l.status = 'vendido')   as vendidos,
  count(l.id) filter (where l.deleted_at is null and l.status = 'reservado') as reservados,
  count(l.id) filter (where l.deleted_at is null and l.category_id is null
                        and l.price_override is null)          as sin_precio
from public.projects p
left join public.manzanas m on m.project_id = p.id
left join public.lots l on l.manzana_id = m.id
group by p.id;

grant select on public.v_proyectos to authenticated;
