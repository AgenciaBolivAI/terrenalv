-- PARÁMETROS DE COMISIONES PARA ASESORES DE INVERSIÓN
--
-- El porcentaje no lo escribe nadie a mano: sale de CUÁNTAS ventas lleva el
-- asesor y de CÓMO vendió — al contado o a plazo, que tienen escalas
-- distintas y a propósito (la de contado mejora desde la sexta venta, para
-- empujar la recaudación).
--
-- Lo importante, y lo que se lee en los ejemplos del documento: la escala es
-- RETROACTIVA. Al llegar a la séptima venta a plazo no se cobra 1,2% de la
-- séptima y 1% de las seis anteriores: se cobra 1,2% de las siete. Por eso el
-- documento muestra 153,60 × 7 = 1.075,20 como piso del tramo. Vender una más
-- sube el porcentaje de todo lo vendido en el período.

create table if not exists public.commission_scales (
  id uuid primary key default gen_random_uuid(),
  gestion int not null,
  modalidad text not null,
  desde int not null,
  hasta int,                       -- null = «adelante»
  pct_inicial numeric(6,3) not null,
  pct_reintegro numeric(6,3) not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commission_scales_modalidad_check check (modalidad in ('contado','plazo')),
  constraint commission_scales_rango_check check (desde >= 1 and (hasta is null or hasta >= desde)),
  constraint commission_scales_pct_check
    check (pct_inicial >= 0 and pct_reintegro >= 0 and pct_inicial + pct_reintegro <= 100)
);

create index if not exists commission_scales_busqueda_idx
  on public.commission_scales(gestion, modalidad, desde) where is_active;

-- Las políticas de la gestión, escritas donde el sistema las pueda leer y no
-- sólo en una planilla que se pierde.
create table if not exists public.commission_policy (
  gestion int primary key,
  -- ¿La cantidad de ventas se cuenta en toda la gestión o mes a mes?
  periodo text not null default 'gestion',
  -- Política 1: a plazo, 50% al completar la cuota inicial y 50% al completar
  -- la 4ta cuota. El «4» vive acá porque el Directorio lo puede mover.
  cuota_reintegro int not null default 4,
  -- Política 3: venta compartida, mitad y mitad.
  split_compartida_pct numeric(5,2) not null default 50,
  -- Políticas 4 y 5: los bonos. Se guardan como parámetro de la gestión.
  bono_equipo_mensual numeric(12,2) not null default 5000,
  bono_personal_semanal numeric(12,2) not null default 2000,
  ventas_objetivo_semanal int not null default 30,
  notas text,
  updated_at timestamptz not null default now(),
  constraint commission_policy_periodo_check check (periodo in ('gestion','mes')),
  constraint commission_policy_cuota_check check (cuota_reintegro >= 1)
);

alter table public.commission_scales enable row level security;
alter table public.commission_policy enable row level security;

drop policy if exists commission_scales_lee on public.commission_scales;
create policy commission_scales_lee on public.commission_scales
  for select to authenticated using (private.is_team());
drop policy if exists commission_policy_lee on public.commission_policy;
create policy commission_policy_lee on public.commission_policy
  for select to authenticated using (private.is_team());

drop trigger if exists solo_lectura on public.commission_scales;
create trigger solo_lectura before insert or update or delete on public.commission_scales
  for each row execute function private.tg_solo_lectura('comisiones');
drop trigger if exists solo_lectura on public.commission_policy;
create trigger solo_lectura before insert or update or delete on public.commission_policy
  for each row execute function private.tg_solo_lectura('comisiones');

-- ---------- La escala 2026, tal cual el documento del Directorio ----------
insert into public.commission_policy (gestion, notas)
values (2026, 'Parámetros de comisiones para asesores de inversión — gestión 2026. '
            || 'Rigen por una gestión y se replantean al inicio de cada año (política 9).')
on conflict (gestion) do nothing;

insert into public.commission_scales (gestion, modalidad, desde, hasta, pct_inicial, pct_reintegro)
values
  -- Ventas a plazo: mitad a la firma, mitad al reintegro. Total 1,0 a 1,8%.
  (2026, 'plazo',    1,   6, 0.50, 0.50),
  (2026, 'plazo',    7,  10, 0.60, 0.60),
  (2026, 'plazo',   11,  15, 0.70, 0.70),
  (2026, 'plazo',   16,  20, 0.80, 0.80),
  (2026, 'plazo',   21, null, 0.90, 0.90),
  -- Ventas al contado: todo al momento de la venta. Escala aparte, que mejora
  -- desde la sexta — es el incentivo a recaudar del que habla la política 2.
  (2026, 'contado',  1,   5, 1.00, 0),
  (2026, 'contado',  6,  10, 1.50, 0),
  (2026, 'contado', 11,  15, 1.80, 0),
  (2026, 'contado', 16, null, 2.00, 0)
on conflict do nothing;
