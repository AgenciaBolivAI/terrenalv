-- LA ADMINISTRACIÓN LLEVA SU PROPIO LIBRO.
--
-- La contadora: «hay gastos propios de administración como servicios básicos,
-- sueldos y salarios, alquileres etc.». Hasta hoy no tenían dónde caer: TODA
-- la contabilidad cuelga de una urbanización —`expenses.project_id` y
-- `journal_entries.project_id` son NOT NULL, `fiscal_periods` es por
-- urbanización y hasta el consolidado se define como «la suma de las filas de
-- projects»—. Un gasto de la oficina terminaba cargado a la urbanización que
-- estuviera seleccionada, o peor: el sueldo de alguien de toda la empresa se
-- cargaba a la PRIMERA urbanización activa por orden alfabético.
--
-- La forma barata y honesta de darle lugar es que Administración SEA una fila
-- de `projects`, marcada. Así no hay que aflojar un solo NOT NULL, ni tocar
-- los INNER JOIN de `v_comprobantes`/`v_egresos`, ni redefinir qué es el
-- consolidado: la sociedad entera sigue siendo la suma de sus filas, y ahora
-- una de esas filas es la administración central.
--
-- Se protege de las dos formas en que podría hacer daño:
--   · `status = 'borrador'` clavado por CHECK — la RLS pública solo deja ver
--     las 'activo', así que ni un anónimo ni un comprador la ven jamás, y
--     nadie puede publicarla por accidente.
--   · una sola, por índice único parcial.
-- Y no se le siembran categorías de precio ni lotes: no vende nada.

alter table public.projects
  add column if not exists es_administracion boolean not null default false;

comment on column public.projects.es_administracion is
  'true = la fila «Administración»: los libros de la empresa que no son de '
  'ninguna urbanización (sueldos, servicios básicos, alquileres, fondos por '
  'rendir). No se vende, no se publica, no tiene lotes.';

create unique index if not exists projects_administracion_unica
  on public.projects (es_administracion) where es_administracion;

alter table public.projects drop constraint if exists projects_administracion_borrador;
alter table public.projects add constraint projects_administracion_borrador
  check (not es_administracion or status = 'borrador');

insert into public.projects
  (slug, name, description, status, currency, tracking_prefix, es_administracion)
select 'administracion', 'Administración',
       'Los gastos de la empresa que no son de ninguna urbanización: sueldos, '
       'servicios básicos, alquileres y fondos por rendir.',
       'borrador', 'BOB', 'ADM', true
 where not exists (select 1 from public.projects where es_administracion);

-- Para que ningún RPC tenga que llevar el uuid escrito.
create or replace function private.proyecto_administracion()
returns uuid
language sql
stable
set search_path to 'public'
as $$ select id from public.projects where es_administracion $$;

comment on function private.proyecto_administracion is
  'El id de la fila «Administración». Los gastos propios de la empresa se '
  'asientan ahí.';

grant execute on function private.proyecto_administracion() to authenticated;

-- ---------------------------------------------------------------------------
-- El sueldo de quien trabaja para toda la empresa deja de caer en la primera
-- urbanización por orden alfabético.
-- ---------------------------------------------------------------------------
do $$
declare v_def text; v_ancla text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_pagar_planilla';

  v_ancla := 'v_proj := coalesce(r.project_id,
      (select id from public.projects where status = ''activo'' order by name limit 1));';
  if position(v_ancla in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA'
      using detail = 'admin_pagar_planilla ya no elige la urbanización como se esperaba.';
  end if;

  execute replace(v_def, v_ancla,
    'v_proj := coalesce(r.project_id, private.proyecto_administracion());');
end $$;

-- ---------------------------------------------------------------------------
-- La pantalla de Urbanizaciones no la lista: no es una urbanización.
-- ---------------------------------------------------------------------------
create or replace view public.v_proyectos as
 SELECT p.id,
    p.slug,
    p.name,
    p.status,
    p.currency,
    p.tracking_prefix,
    p.location_text,
    p.geometry_version,
    p.created_at,
    count(DISTINCT m.id) AS manzanas,
    count(l.id) FILTER (WHERE l.deleted_at IS NULL) AS lotes,
    count(l.id) FILTER (WHERE l.deleted_at IS NULL AND l.status = 'vendido'::lot_status) AS vendidos,
    count(l.id) FILTER (WHERE l.deleted_at IS NULL AND l.status = 'reservado'::lot_status) AS reservados,
    count(l.id) FILTER (WHERE l.deleted_at IS NULL AND l.category_id IS NULL AND l.price_override IS NULL) AS sin_precio
   FROM projects p
     LEFT JOIN manzanas m ON m.project_id = p.id
     LEFT JOIN lots l ON l.manzana_id = m.id
  WHERE NOT p.es_administracion
  GROUP BY p.id;
