-- Sales tables: reservations and payments. These carry buyer PII and have NO anon
-- RLS policies at all — guests interact exclusively through SECURITY DEFINER RPCs.

create table public.reservations (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects (id),
  lot_id               uuid not null references public.lots (id),
  tracking_code        text not null unique,
  buyer_full_name      text not null,
  buyer_ci             text not null,
  buyer_ci_normalized  text not null,
  buyer_phone          text not null,
  buyer_email          text,
  status               public.reservation_status not null default 'pendiente_pago',
  -- NULL while en_verificacion: the countdown pauses while the team reviews.
  hold_expires_at      timestamptz,
  retry_expires_at     timestamptz,
  price_agreed         numeric(12,2) not null check (price_agreed >= 0),
  amount_due           numeric(12,2) not null check (amount_due >= 0),
  amount_due_currency  char(3) not null check (amount_due_currency in ('USD', 'BOB')),
  currency             char(3) not null check (currency in ('USD', 'BOB')),
  terms_version        text,
  terms_accepted_at    timestamptz,
  source               text not null default 'web' check (source in ('web', 'oficina')),
  verified_by          uuid references public.profiles (id) on delete set null,
  confirmed_at         timestamptz,
  expired_at           timestamptz,
  cancelled_at         timestamptz,
  cancel_reason        text,
  client_meta          jsonb not null default '{}',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- THE anti-double-booking invariant: at most one live claim per lot, enforced by the
-- database itself. Everything else (row locks, realtime UI) is polish on top of this.
create unique index reservations_one_active_per_lot_uidx on public.reservations (lot_id)
  where status in ('pendiente_pago', 'en_verificacion', 'rechazo_reintento', 'confirmada');

create index reservations_project_status_idx on public.reservations (project_id, status);
create index reservations_ci_active_idx on public.reservations (buyer_ci_normalized)
  where status in ('pendiente_pago', 'en_verificacion', 'rechazo_reintento');
create index reservations_expiry_idx on public.reservations (hold_expires_at)
  where status = 'pendiente_pago';
create index reservations_retry_expiry_idx on public.reservations (retry_expires_at)
  where status = 'rechazo_reintento';

create trigger set_updated_at before update on public.reservations
  for each row execute function private.tg_set_updated_at();

alter table public.lots
  add constraint lots_active_reservation_fk
  foreign key (active_reservation_id) references public.reservations (id) on delete set null;

-- Payment rows are created AT reservation time (intent-at-creation): the glosa
-- reference_code must exist before the buyer transfers, or the verifier's
-- screenshot-vs-glosa matching workflow is impossible.
create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects (id),
  reservation_id      uuid not null references public.reservations (id) on delete cascade,
  provider            public.payment_provider_kind not null default 'manual_qr',
  provider_ref        text,
  reference_code      text not null unique,
  purpose             text not null default 'reserva' check (purpose in ('reserva', 'cuota')),
  amount              numeric(12,2) not null check (amount >= 0),
  currency            char(3) not null check (currency in ('USD', 'BOB')),
  amount_bob          numeric(12,2) not null check (amount_bob >= 0),
  exchange_rate_used  numeric(10,4) not null check (exchange_rate_used > 0),
  status              public.payment_status not null default 'pendiente',
  proof_storage_path  text,
  proof_sha256        text,
  proof_submitted_at  timestamptz,
  verified_by         uuid references public.profiles (id) on delete set null,
  verified_at         timestamptz,
  rejection_reason    public.rejection_reason_kind,
  rejection_note      text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index payments_provider_ref_uidx on public.payments (provider, provider_ref)
  where provider_ref is not null;
create index payments_reservation_idx on public.payments (reservation_id);
create index payments_open_idx on public.payments (created_at)
  where status in ('pendiente', 'comprobante_subido');
-- Duplicate-screenshot fraud detection (same image reused across reservations).
create index payments_proof_sha_idx on public.payments (proof_sha256)
  where proof_sha256 is not null;

create trigger set_updated_at before update on public.payments
  for each row execute function private.tg_set_updated_at();
