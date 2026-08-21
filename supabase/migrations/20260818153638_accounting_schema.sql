create type public.installment_status as enum ('pendiente', 'parcial', 'pagada', 'anulada');
create type public.plan_status as enum ('activo', 'completado', 'cancelado');
create type public.expense_category as enum (
  'obra', 'comisiones', 'sueldos', 'publicidad', 'administracion', 'impuestos', 'financiero', 'otros'
);

create table public.installment_plans (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects (id) on delete cascade,
  reservation_id      uuid not null references public.reservations (id) on delete cascade,
  total_price         numeric(12,2) not null check (total_price > 0),
  currency            char(3) not null,
  down_payment        numeric(12,2) not null default 0 check (down_payment >= 0),
  financed_amount     numeric(12,2) not null check (financed_amount >= 0),
  months              int not null check (months between 1 and 480),
  monthly_amount      numeric(12,2) not null check (monthly_amount > 0),
  annual_interest_pct numeric(6,3) not null default 0 check (annual_interest_pct >= 0),
  first_due_date      date not null,
  status              public.plan_status not null default 'activo',
  note                text,
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint plan_amounts_coherent check (
    down_payment <= total_price and financed_amount = total_price - down_payment
  )
);

create unique index installment_plans_one_active
  on public.installment_plans (reservation_id)
  where status <> 'cancelado';
create index installment_plans_project on public.installment_plans (project_id, status);

create table public.installments (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references public.installment_plans (id) on delete cascade,
  project_id   uuid not null references public.projects (id) on delete cascade,
  number       int not null check (number >= 1),
  due_date     date not null,
  amount       numeric(12,2) not null check (amount > 0),
  currency     char(3) not null,
  amount_paid  numeric(12,2) not null default 0 check (amount_paid >= 0),
  status       public.installment_status not null default 'pendiente',
  paid_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (plan_id, number)
);

create index installments_due on public.installments (project_id, status, due_date);
create index installments_plan on public.installments (plan_id, number);

create table public.payment_allocations (
  id              uuid primary key default gen_random_uuid(),
  payment_id      uuid not null references public.payments (id) on delete cascade,
  installment_id  uuid not null references public.installments (id) on delete cascade,
  amount          numeric(12,2) not null check (amount > 0),
  created_at      timestamptz not null default now(),
  unique (payment_id, installment_id)
);

create index allocations_installment on public.payment_allocations (installment_id);

create table public.expenses (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects (id) on delete cascade,
  incurred_on          date not null,
  category             public.expense_category not null,
  description          text not null check (btrim(description) <> ''),
  supplier             text,
  amount               numeric(12,2) not null check (amount > 0),
  currency             char(3) not null,
  amount_bob           numeric(12,2) not null check (amount_bob > 0),
  exchange_rate_used   numeric(10,4) not null,
  receipt_storage_path text,
  note                 text,
  created_by           uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);

create index expenses_period on public.expenses (project_id, incurred_on) where deleted_at is null;
create index expenses_category on public.expenses (project_id, category) where deleted_at is null;

create or replace function private.tg_installment_recalc()
returns trigger
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_installment_id uuid;
  v_paid numeric(12,2);
  v_amount numeric(12,2);
  v_status public.installment_status;
begin
  v_installment_id := coalesce(new.installment_id, old.installment_id);

  select coalesce(sum(amount), 0) into v_paid
    from public.payment_allocations where installment_id = v_installment_id;
  select amount into v_amount from public.installments where id = v_installment_id;

  if v_paid >= v_amount - 0.01 then
    v_status := 'pagada';
  elsif v_paid > 0 then
    v_status := 'parcial';
  else
    v_status := 'pendiente';
  end if;

  update public.installments
     set amount_paid = v_paid,
         status      = case when status = 'anulada' then 'anulada' else v_status end,
         paid_at     = case when v_status = 'pagada' then coalesce(paid_at, now()) else null end,
         updated_at  = now()
   where id = v_installment_id;

  update public.installment_plans p
     set status = 'completado', updated_at = now()
   where p.id = (select plan_id from public.installments where id = v_installment_id)
     and p.status = 'activo'
     and not exists (
       select 1 from public.installments i
        where i.plan_id = p.id and i.status not in ('pagada', 'anulada'));

  return null;
end;
$fn$;

create trigger tg_allocation_recalc
  after insert or update or delete on public.payment_allocations
  for each row execute function private.tg_installment_recalc();

create trigger set_updated_at before update on public.installment_plans
  for each row execute function private.tg_set_updated_at();
create trigger set_updated_at before update on public.installments
  for each row execute function private.tg_set_updated_at();
create trigger set_updated_at before update on public.expenses
  for each row execute function private.tg_set_updated_at();

alter table public.installment_plans enable row level security;
alter table public.installments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.expenses enable row level security;

revoke insert, update, delete, truncate, references, trigger
  on public.installment_plans, public.installments, public.payment_allocations, public.expenses
  from anon, authenticated;

create policy plans_team_read on public.installment_plans
  for select to authenticated using (private.is_team());
create policy installments_team_read on public.installments
  for select to authenticated using (private.is_team());
create policy allocations_team_read on public.payment_allocations
  for select to authenticated using (private.is_team());
create policy expenses_admin_read on public.expenses
  for select to authenticated using (private.is_admin());
