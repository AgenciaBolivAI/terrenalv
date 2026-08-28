-- LA CUENTA DEL COMPRADOR.
--
-- Hasta hoy el comprador no tenía cuenta: su única llave era el código de
-- seguimiento. Sirve para mirar una compra, pero no es una plataforma — no hay
-- a quién saludar en su cumpleaños, no hay a quién escribirle, y para publicar
-- en el mercado había que pedirle un código que la mitad perdió.
--
-- El comprador ahora tiene su propia cuenta de verdad, SEPARADA del equipo:
-- `profiles` es del personal y `private.is_team()` exige una fila ahí, así que
-- un cliente logueado NUNCA es equipo por más que tenga sesión. Las políticas
-- que se agregan acá son estrechas y explícitas: cada cliente ve LO SUYO.
create table if not exists public.customers (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  phone text,
  ci text,
  ci_normalized text,
  -- Para el saludo de aniversario y de cumpleaños que pidió el dueño.
  birth_date date,
  city text,
  como_nos_conocio text,
  marketing_opt_in boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create unique index if not exists customers_email_idx on public.customers (lower(email));
create index if not exists customers_ci_idx on public.customers (ci_normalized);
create index if not exists customers_cumple_idx
  on public.customers ((extract(month from birth_date)), (extract(day from birth_date)));

-- La compra queda atada a la cuenta. Nullable: las 21 ventas viejas no tienen
-- dueño con cuenta todavía, y se van vinculando a medida que cada uno se
-- registra y reclama la suya.
alter table public.reservations
  add column if not exists customer_id uuid references public.customers(id) on delete set null;
create index if not exists reservations_customer_idx on public.reservations (customer_id);

alter table public.customers enable row level security;

-- Cada cliente ve y edita SU ficha, y nada más.
drop policy if exists customers_self_read on public.customers;
create policy customers_self_read on public.customers
  for select to authenticated
  using (id = (select auth.uid()) or private.is_team());

drop policy if exists customers_self_update on public.customers;
create policy customers_self_update on public.customers
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Sus compras y sus pagos. La política del equipo sigue intacta al lado.
drop policy if exists reservations_customer_read on public.reservations;
create policy reservations_customer_read on public.reservations
  for select to authenticated
  using (customer_id = (select auth.uid()));

drop policy if exists payments_customer_read on public.payments;
create policy payments_customer_read on public.payments
  for select to authenticated
  using (exists (select 1 from public.reservations r
                  where r.id = payments.reservation_id
                    and r.customer_id = (select auth.uid())));

grant select on public.customers to authenticated;
grant update (full_name, phone, ci, birth_date, city, como_nos_conocio, marketing_opt_in)
  on public.customers to authenticated;
