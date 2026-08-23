-- Terrenalv vende en bolivianos y nada más.
--
-- El esquema permitía llevar una urbanización en dólares: el panel nunca lo
-- ofreció (ProjectsClient manda 'BOB' fijo), pero la RPC aceptaba cualquier
-- moneda, así que bastaba una llamada directa a la API —o un descuido futuro—
-- para crear un proyecto en USD. Con eso, precios, cuotas, recibos y estados
-- contables quedarían en una moneda que la empresa no maneja.
--
-- Se cierra en la base y no solo en la pantalla: una regla de negocio que vive
-- únicamente en el formulario no es una regla, es una costumbre.

alter table public.projects
  add constraint proyectos_solo_bolivianos check (currency = 'BOB');

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
  v_id uuid;
  v_slug text;
  v_prefix text;
begin
  v_actor := private.assert_admin();

  if btrim(coalesce(p_name, '')) = '' then raise exception 'NAME_REQUIRED'; end if;
  -- Explícito y temprano: es mejor un error claro que un proyecto en dólares
  -- que recién se descubre cuando alguien imprime un recibo.
  if coalesce(p_currency, 'BOB') <> 'BOB' then raise exception 'SOLO_BOLIVIANOS'; end if;

  -- Slug para la URL pública.
  v_slug := lower(btrim(coalesce(nullif(btrim(p_slug), ''), p_name)));
  v_slug := regexp_replace(translate(v_slug, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'), '[^a-z0-9]+', '-', 'g');
  v_slug := btrim(v_slug, '-');
  if v_slug = '' then raise exception 'SLUG_REQUIRED'; end if;
  if exists (select 1 from public.projects where slug = v_slug) then
    raise exception 'SLUG_TAKEN';
  end if;

  -- Prefijo de los códigos de reserva: mayúsculas ANTES de filtrar, si no
  -- todo termina en el mismo prefijo.
  v_prefix := upper(coalesce(nullif(btrim(p_tracking_prefix), ''), left(p_name, 3)));
  v_prefix := regexp_replace(translate(v_prefix, 'ÁÉÍÓÚÜÑ', 'AEIOUUN'), '[^A-Z0-9]', '', 'g');
  v_prefix := left(coalesce(nullif(v_prefix, ''), 'PRY'), 3);
  while exists (select 1 from public.projects where tracking_prefix = v_prefix) loop
    v_prefix := left(v_prefix, 2) || chr(65 + floor(random() * 26)::int);
  end loop;

  insert into public.projects (name, slug, location_text, currency, tracking_prefix,
                               description, status)
  values (btrim(p_name), v_slug, nullif(btrim(coalesce(p_location, '')), ''), 'BOB',
          v_prefix, nullif(btrim(coalesce(p_description, '')), ''), 'borrador')
  returning id into v_id;

  -- Sin categorías no se le puede poner precio a un lote, y un lote sin precio
  -- no se reserva: la urbanización nacería muerta.
  insert into public.pricing_categories (project_id, code, name, price_per_m2, color_hex, sort_order)
  select v_id, c.code, c.name, 0, c.color, c.orden
    from (values ('A', 'Categoría A', '#2e7d32', 1),
                 ('B', 'Categoría B', '#558b2f', 2),
                 ('C', 'Categoría C', '#9e9d24', 3),
                 ('D', 'Categoría D', '#ef6c00', 4),
                 ('E', 'Categoría E', '#c62828', 5)) as c(code, name, color, orden);

  perform private.audit('team', v_actor, null, 'project.created', v_id, 'project', v_id,
    null, jsonb_build_object('nombre', btrim(p_name), 'slug', v_slug, 'prefijo', v_prefix));

  return jsonb_build_object('project_id', v_id, 'slug', v_slug, 'tracking_prefix', v_prefix);
end;
$fn$;

revoke execute on function public.admin_create_project(text, text, text, char, text, text)
  from public, anon;
grant execute on function public.admin_create_project(text, text, text, char, text, text)
  to authenticated, service_role;
