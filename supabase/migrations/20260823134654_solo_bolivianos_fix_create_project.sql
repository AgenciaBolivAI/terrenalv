-- Restaura admin_create_project tal como estaba y le agrega SOLO la guarda de
-- moneda.
--
-- La versión anterior de esta migración reescribió la función de memoria y en
-- el camino perdió utm_epsg = 32720 (la zona UTM con la que se proyecta la
-- geometría del plano: sin eso, una urbanización nueva no puede dibujar su
-- mapa), cambió los colores de las categorías, y reemplazó el error
-- PREFIX_TAKEN por un bucle que mutaba el prefijo en silencio.

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
  -- Terrenalv opera solo en bolivianos. Explícito y temprano: mejor un error
  -- claro que descubrir la moneda equivocada al imprimir un recibo.
  if coalesce(p_currency, 'BOB') <> 'BOB' then raise exception 'SOLO_BOLIVIANOS'; end if;

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
     'BOB', v_prefix, 32720)
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
