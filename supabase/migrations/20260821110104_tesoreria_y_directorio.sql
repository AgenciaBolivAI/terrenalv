-- Bancos, cajas y directorio de terceros.
--
-- Hasta acá toda la plata caía en UNA cuenta contable, "Caja y Bancos" (1111):
-- lo que entró por el Banco Ganadero, lo que entró en efectivo en el mostrador
-- y lo que salió por transferencia se sumaban en la misma línea. Con eso no se
-- puede conciliar un extracto bancario ni saber cuánto hay en la caja chica.
--
-- Y el proveedor de un egreso era texto libre, así que "Ferretería Sur",
-- "ferreteria sur" y "FERRET. SUR" eran tres proveedores distintos para
-- cualquier reporte.

-- ============================================================================
-- Directorio de terceros
-- ============================================================================
create type public.contact_kind as enum ('proveedor', 'cliente', 'empleado', 'otro');

create table if not exists public.contacts (
  id          uuid primary key default gen_random_uuid(),
  kind        public.contact_kind not null default 'proveedor',
  name        text not null check (btrim(name) <> ''),
  -- NIT o CI: lo que va en una factura boliviana.
  tax_id      text,
  phone       text,
  email       text,
  address     text,
  notes       text,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Un mismo NIT no se carga dos veces; sin NIT se permite repetir nombre porque
-- hay proveedores informales sin identificación.
create unique index if not exists contacts_tax_id_uq
  on public.contacts (tax_id) where tax_id is not null and btrim(tax_id) <> '';
create index if not exists contacts_kind on public.contacts (kind, is_active);

-- ============================================================================
-- Cuentas de tesorería: bancos y cajas
-- ============================================================================
create type public.treasury_kind as enum ('banco', 'caja', 'billetera');

create table if not exists public.treasury_accounts (
  id            uuid primary key default gen_random_uuid(),
  kind          public.treasury_kind not null default 'banco',
  name          text not null check (btrim(name) <> ''),
  bank_name     text,
  account_number text,
  currency      char(3) not null default 'BOB',
  -- Cada banco y cada caja tiene SU cuenta en el plan. Es lo que permite
  -- conciliar contra un extracto: el saldo contable de esa cuenta tiene que dar
  -- lo mismo que el banco.
  account_code  text not null references public.chart_of_accounts (code),
  opening_balance numeric(14,2) not null default 0,
  opening_date  date,
  is_active     boolean not null default true,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (account_code)
);

create index if not exists treasury_activas on public.treasury_accounts (is_active, kind);

-- ============================================================================
-- De dónde salió y a dónde entró cada movimiento
-- ============================================================================
alter table public.expenses
  add column if not exists treasury_account_id uuid references public.treasury_accounts (id),
  add column if not exists contact_id uuid references public.contacts (id);

alter table public.payments
  add column if not exists treasury_account_id uuid references public.treasury_accounts (id);

create index if not exists expenses_tesoreria on public.expenses (treasury_account_id) where deleted_at is null;
create index if not exists expenses_contacto on public.expenses (contact_id) where deleted_at is null;
create index if not exists payments_tesoreria on public.payments (treasury_account_id);

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.contacts enable row level security;
alter table public.treasury_accounts enable row level security;

revoke insert, update, delete, truncate on public.contacts, public.treasury_accounts
  from anon, authenticated;

-- El directorio lo usa también ventas (proveedores, clientes): lectura de equipo.
create policy contacts_read on public.contacts
  for select to authenticated using (private.is_team());
-- Los saldos bancarios no: solo contabilidad.
create policy treasury_read on public.treasury_accounts
  for select to authenticated using (private.is_accounting());

create trigger set_updated_at before update on public.contacts
  for each row execute function private.tg_set_updated_at();
create trigger set_updated_at before update on public.treasury_accounts
  for each row execute function private.tg_set_updated_at();
