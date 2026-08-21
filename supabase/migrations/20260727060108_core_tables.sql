-- Core inventory tables: projects, pricing categories, manzanas, map elements,
-- plano sheets, lots. All geometry is PostGIS SRID 0 "plan-space": meters,
-- +X east, +Y north, calibrated as offset-UTM (EPSG:32720 minus a stored constant).

create table public.projects (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name              text not null,
  description       text,
  location_text     text,
  status            text not null default 'borrador' check (status in ('activo', 'borrador', 'archivado')),
  currency          char(3) not null default 'USD' check (currency in ('USD', 'BOB')),
  tracking_prefix   text not null default 'EDS' check (tracking_prefix ~ '^[A-Z]{2,5}$'),
  utm_epsg          int not null default 32720,
  utm_offset_e      numeric(12,2),
  utm_offset_n      numeric(12,2),
  plan_to_utm       jsonb,
  geometry_version  int not null default 0,
  status_rev        bigint not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger set_updated_at before update on public.projects
  for each row execute function private.tg_set_updated_at();

-- The plano's A–E color tiers. price_per_m2 is in the project currency.
create table public.pricing_categories (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  code          text not null,
  name          text,
  color_hex     text not null check (color_hex ~ '^#[0-9a-fA-F]{6}$'),
  price_per_m2  numeric(10,2) not null check (price_per_m2 >= 0),
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (project_id, code)
);

create trigger set_updated_at before update on public.pricing_categories
  for each row execute function private.tg_set_updated_at();

create table public.manzanas (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects (id) on delete cascade,
  code              text not null,
  kind              public.manzana_kind not null default 'residencial',
  sector            text,
  geom              extensions.geometry(Polygon) check (geom is null or extensions.st_isvalid(geom)),
  label_anchor      jsonb,
  subdivision_spec  jsonb,
  state             public.geom_state not null default 'draft',
  needs_review      boolean not null default false,
  version           int not null default 1,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (project_id, code)
);

create index manzanas_project_idx on public.manzanas (project_id);

create trigger set_updated_at before update on public.manzanas
  for each row execute function private.tg_set_updated_at();

create table public.map_elements (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  kind        public.element_kind not null,
  name        text,
  geom        extensions.geometry not null check (extensions.st_isvalid(geom)),
  props       jsonb not null default '{}',
  state       public.geom_state not null default 'draft',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index map_elements_project_idx on public.map_elements (project_id);

create trigger set_updated_at before update on public.map_elements
  for each row execute function private.tg_set_updated_at();

-- Calibrated raster scans of the printed planos (Builder underlay only, private bucket).
create table public.plano_sheets (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  title         text,
  storage_path  text not null,
  width_px      int,
  height_px     int,
  px_to_plan    jsonb,
  calibration   jsonb,
  created_at    timestamptz not null default now()
);

create index plano_sheets_project_idx on public.plano_sheets (project_id);

create table public.lots (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references public.projects (id) on delete cascade,
  manzana_id             uuid not null references public.manzanas (id) on delete cascade,
  number                 text not null,
  status                 public.lot_status not null default 'disponible',
  category_id            uuid references public.pricing_categories (id) on delete set null,
  frontage_m             numeric(8,2) check (frontage_m is null or frontage_m > 0),
  depth_m                numeric(8,2) check (depth_m is null or depth_m > 0),
  -- area_m2 is the OFFICIAL printed/legal area shown to buyers and used for pricing;
  -- computed_area_m2 is the geometric truth, kept for the >3% digitization QA gate.
  area_m2                numeric(10,2) not null check (area_m2 > 0),
  computed_area_m2       double precision generated always as (extensions.st_area(geom)) stored,
  is_corner              boolean not null default false,
  is_manual_geom         boolean not null default false,
  edge_dims              jsonb,
  geom                   extensions.geometry(Polygon) not null check (extensions.st_isvalid(geom)),
  price_override         numeric(12,2) check (price_override is null or price_override >= 0),
  active_reservation_id  uuid,
  state                  public.geom_state not null default 'draft',
  needs_review           boolean not null default false,
  version                int not null default 1,
  deleted_at             timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create unique index lots_manzana_number_uidx on public.lots (manzana_id, number)
  where deleted_at is null;
create index lots_project_status_idx on public.lots (project_id, status);
create index lots_manzana_idx on public.lots (manzana_id);
create index lots_geom_gix on public.lots using gist (geom);

create trigger set_updated_at before update on public.lots
  for each row execute function private.tg_set_updated_at();

-- Single source of truth for pricing: the number the buyer sees, the number frozen
-- into a reservation, and the number in the admin panel can never drift.
-- Returns NULL when the lot is unpriced (no category and no override) — callers
-- treat that as "not reservable yet" (LOT_NOT_PRICED).
create or replace function public.lot_price(p_lot_id uuid)
returns numeric
language sql
stable
set search_path = public, extensions
as $$
  select coalesce(l.price_override, round(pc.price_per_m2 * l.area_m2, 2))
  from public.lots l
  left join public.pricing_categories pc on pc.id = l.category_id
  where l.id = p_lot_id;
$$;
