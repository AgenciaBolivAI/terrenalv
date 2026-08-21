-- Contabilidad completa: plan de cuentas editable, comprobantes manuales,
-- reexpresión monetaria por UFV y cierre de gestión.
--
-- Hasta acá la contabilidad era 100% derivada: cada asiento salía de una venta,
-- un pago o un egreso. Eso cubre la operación diaria pero deja afuera todo lo
-- que un contador necesita registrar a mano — aportes de capital,
-- depreciaciones, correcciones, el ajuste por inflación y el cierre anual — y
-- sin eso el sistema no reemplaza a un ERP contable, solo lo acompaña.

-- ============================================================================
-- 1. Plan de cuentas editable
-- ============================================================================
alter table public.chart_of_accounts
  add column if not exists parent_code text,
  add column if not exists is_active boolean not null default true,
  -- Las cuentas que usa el diario derivado no se pueden borrar ni renumerar:
  -- si desaparece 1111, los cobros dejan de tener contrapartida y el libro
  -- deja de cuadrar sin que nadie toque un asiento.
  add column if not exists is_system boolean not null default false,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.chart_of_accounts
   set is_system = true
 where code in ('1111', '1131', '2131', '4111',
                '5111', '5211', '5221', '5311', '5411', '5511', '5611', '5911');

-- Cuentas que necesitan la reexpresión y el cierre.
insert into public.chart_of_accounts (code, name, kind, sort_order, is_system) values
  ('3111', 'Capital Social',                 'patrimonio', 200, false),
  ('3411', 'Ajuste Global del Patrimonio',   'patrimonio', 210, true),
  ('3511', 'Resultados Acumulados',          'patrimonio', 220, true),
  ('3611', 'Resultado de la Gestión',        'patrimonio', 230, true),
  ('5711', 'AITB — Ajuste por Inflación',    'gasto',      700, true)
on conflict (code) do nothing;

create policy coa_admin_insert on public.chart_of_accounts
  for insert to authenticated with check (private.is_accounting());
create policy coa_admin_update on public.chart_of_accounts
  for update to authenticated using (private.is_accounting()) with check (private.is_accounting());

-- ============================================================================
-- 2. Gestiones (ejercicios) y su cierre
-- ============================================================================
create table if not exists public.fiscal_periods (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  year        int not null,
  starts_on   date not null,
  ends_on     date not null,
  status      text not null default 'abierto' check (status in ('abierto', 'cerrado')),
  closed_at   timestamptz,
  closed_by   uuid references public.profiles (id) on delete set null,
  closing_entry_id uuid,
  created_at  timestamptz not null default now(),
  unique (project_id, year),
  constraint period_range check (ends_on > starts_on)
);

-- ============================================================================
-- 3. Comprobantes manuales
-- ============================================================================
create type public.voucher_kind as enum ('ingreso', 'egreso', 'traspaso', 'apertura', 'ajuste', 'cierre');
create type public.voucher_status as enum ('borrador', 'registrado', 'anulado');

create table if not exists public.journal_entries (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  -- Numeración por proyecto y por tipo, como la pide un contador: ING-0001.
  number      text not null,
  kind        public.voucher_kind not null default 'traspaso',
  entry_date  date not null,
  glosa       text not null check (btrim(glosa) <> ''),
  status      public.voucher_status not null default 'borrador',
  -- Los asientos que genera el sistema (cierre, reexpresión) se marcan para
  -- que nadie los edite a mano y descuadre lo que ya se cerró.
  is_automatic boolean not null default false,
  created_by  uuid references public.profiles (id) on delete set null,
  posted_by   uuid references public.profiles (id) on delete set null,
  posted_at   timestamptz,
  voided_note text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (project_id, number)
);

create index if not exists journal_entries_fecha on public.journal_entries (project_id, entry_date);
create index if not exists journal_entries_estado on public.journal_entries (project_id, status);

create table if not exists public.journal_lines (
  id         uuid primary key default gen_random_uuid(),
  entry_id   uuid not null references public.journal_entries (id) on delete cascade,
  account_code text not null references public.chart_of_accounts (code),
  debe       numeric(14,2) not null default 0 check (debe >= 0),
  haber      numeric(14,2) not null default 0 check (haber >= 0),
  glosa      text,
  sort_order int not null default 0,
  -- Una línea es debe o haber, nunca las dos ni ninguna: es la regla que evita
  -- que un asiento "cuadre" con líneas que se anulan solas.
  constraint linea_un_solo_lado check ((debe > 0 and haber = 0) or (haber > 0 and debe = 0))
);

create index if not exists journal_lines_entry on public.journal_lines (entry_id, sort_order);
create index if not exists journal_lines_cuenta on public.journal_lines (account_code);

-- ============================================================================
-- 4. UFV — Unidad de Fomento de Vivienda
-- ============================================================================
create table if not exists public.ufv_rates (
  rate_date date primary key,
  value     numeric(12,5) not null check (value > 0),
  source    text not null default 'manual',
  created_at timestamptz not null default now()
);

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.fiscal_periods enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
alter table public.ufv_rates enable row level security;

revoke insert, update, delete, truncate on
  public.fiscal_periods, public.journal_entries, public.journal_lines, public.ufv_rates
  from anon, authenticated;

create policy periods_read on public.fiscal_periods
  for select to authenticated using (private.is_accounting());
create policy entries_read on public.journal_entries
  for select to authenticated using (private.is_accounting());
create policy lines_read on public.journal_lines
  for select to authenticated using (private.is_accounting());
-- La UFV es un dato público del BCB; todo el equipo puede leerla.
create policy ufv_read on public.ufv_rates
  for select to authenticated using (private.is_team());

create trigger set_updated_at before update on public.journal_entries
  for each row execute function private.tg_set_updated_at();
create trigger set_updated_at before update on public.chart_of_accounts
  for each row execute function private.tg_set_updated_at();
