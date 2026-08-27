-- ACTIVO FIJO — lo que se compra y no se gasta de una: una camioneta, una
-- retroexcavadora, las computadoras de la oficina.
--
-- La diferencia con un egreso común es que esto NO es gasto el día que se
-- compra: es un bien que vale, y que se va gastando con los años. Esa parte
-- que se gasta cada mes es la depreciación, y es lo que el sistema calcula
-- solo.
--
-- Se deprecia en línea recta: valor a depreciar (costo menos valor residual)
-- repartido en partes iguales por los meses de vida útil. La última cuota se
-- ajusta a los centavos que sobran, para que el bien termine EXACTAMENTE en
-- su valor residual y no en 0,03 de más.
--
-- OJO CON LAS TASAS: las que vienen cargadas son las usuales en Bolivia
-- (DS 24051) — vehículos 5 años, computación 4, muebles 10, maquinaria 8,
-- edificaciones 40. Vienen como VALOR EDITABLE, no clavadas: confirmalas
-- contra la norma vigente antes de cerrar una gestión con ellas.
--
-- LO QUE NO HACE: la actualización por UFV de los activos (reexpresión). Los
-- valores acá son históricos. El módulo de reexpresión que ya existe es otra
-- cosa; si hace falta atarlos, se hace aparte y se dice.

create table if not exists public.asset_categories (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  nombre text not null,
  vida_util_meses int not null,
  -- Cuenta del activo (1xxx) y cuenta del gasto de depreciación (5xxx).
  cuenta_activo text references public.chart_of_accounts(code),
  cuenta_depreciacion text references public.chart_of_accounts(code),
  cuenta_acumulada text references public.chart_of_accounts(code),
  is_active boolean not null default true,
  sort_order int not null default 0,
  constraint asset_categories_vida_check check (vida_util_meses between 1 and 1200),
  constraint asset_categories_codigo_check check (btrim(codigo) <> '')
);

create unique index if not exists asset_categories_codigo_uidx
  on public.asset_categories (lower(btrim(codigo)));

create table if not exists public.fixed_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  categoria_id uuid not null references public.asset_categories(id),
  codigo text not null,
  nombre text not null,
  descripcion text,
  -- Identificación física: placa, serie, lo que permita encontrarlo.
  identificacion text,
  fecha_compra date not null,
  -- Desde cuándo se deprecia. Suele ser la compra, pero un bien puede
  -- comprarse en marzo y entrar en servicio en mayo.
  fecha_alta date not null,
  costo numeric(14,2) not null,
  valor_residual numeric(14,2) not null default 0,
  vida_util_meses int not null,
  centro_costo_id uuid references public.centros_costo(id),
  proveedor_contact_id uuid references public.contacts(id),
  -- De qué egreso salió, si se cargó desde contabilidad.
  expense_id uuid references public.expenses(id),
  titular text not null default 'empresa',
  titular_nombre text,
  estado text not null default 'activo',
  fecha_baja date,
  motivo_baja text,
  valor_venta numeric(14,2),
  nota text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fixed_assets_costo_check check (costo > 0),
  constraint fixed_assets_residual_check check (valor_residual >= 0 and valor_residual < costo),
  constraint fixed_assets_vida_check check (vida_util_meses between 1 and 1200),
  constraint fixed_assets_estado_check check (estado in ('activo','dado_de_baja','vendido')),
  constraint fixed_assets_titular_check check (titular in ('empresa','tercero')),
  constraint fixed_assets_tercero_check
    check (titular <> 'tercero' or btrim(coalesce(titular_nombre,'')) <> ''),
  constraint fixed_assets_baja_check
    check (estado = 'activo' or fecha_baja is not null),
  constraint fixed_assets_alta_check check (fecha_alta >= fecha_compra)
);

create unique index if not exists fixed_assets_codigo_uidx
  on public.fixed_assets (lower(btrim(codigo)));
create index if not exists fixed_assets_proyecto_idx on public.fixed_assets(project_id, estado);
create index if not exists fixed_assets_categoria_idx on public.fixed_assets(categoria_id);

alter table public.asset_categories enable row level security;
alter table public.fixed_assets     enable row level security;

drop policy if exists asset_categories_lee on public.asset_categories;
create policy asset_categories_lee on public.asset_categories
  for select to authenticated using (private.is_team());
drop policy if exists fixed_assets_lee on public.fixed_assets;
create policy fixed_assets_lee on public.fixed_assets
  for select to authenticated using (private.is_team());

drop trigger if exists solo_lectura on public.asset_categories;
create trigger solo_lectura before insert or update or delete on public.asset_categories
  for each row execute function private.tg_solo_lectura('activos');
drop trigger if exists solo_lectura on public.fixed_assets;
create trigger solo_lectura before insert or update or delete on public.fixed_assets
  for each row execute function private.tg_solo_lectura('activos');

-- ---------- las cuentas que hacen falta -------------------------------------
insert into public.chart_of_accounts (code, name, kind, sort_order, is_active, is_system)
values
  ('1241', 'Muebles y Enseres',                 'activo', 241, true, true),
  ('1242', 'Equipos de Computación',            'activo', 242, true, true),
  ('1243', 'Vehículos',                         'activo', 243, true, true),
  ('1244', 'Maquinaria y Equipo',               'activo', 244, true, true),
  ('1245', 'Edificaciones',                     'activo', 245, true, true),
  ('1249', 'Otros Activos Fijos',               'activo', 249, true, true),
  ('1290', 'Depreciación Acumulada',            'activo', 290, true, true),
  ('5811', 'Depreciación del Ejercicio',        'gasto',  581, true, true)
on conflict (code) do nothing;

-- ---------- las categorías, con sus vidas útiles ----------------------------
insert into public.asset_categories
  (codigo, nombre, vida_util_meses, cuenta_activo, cuenta_depreciacion, cuenta_acumulada, sort_order)
values
  ('VEH',  'Vehículos automotores',      60,  '1243', '5811', '1290', 10),
  ('COMP', 'Equipos de computación',     48,  '1242', '5811', '1290', 20),
  ('MAQ',  'Maquinaria y equipo',        96,  '1244', '5811', '1290', 30),
  ('MUEB', 'Muebles y enseres',         120,  '1241', '5811', '1290', 40),
  ('EDIF', 'Edificaciones',             480,  '1245', '5811', '1290', 50),
  ('OTRO', 'Otros activos fijos',       120,  '1249', '5811', '1290', 90)
on conflict do nothing;
