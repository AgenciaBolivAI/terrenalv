-- Team-facing tables: profiles, notifications (+reads), outbox, settings, audit log.

-- Team members only — guests never get rows here. Invite-only via admin API.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null,
  role        public.team_role not null default 'ventas',
  phone       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger set_updated_at before update on public.profiles
  for each row execute function private.tg_set_updated_at();

-- Shared team feed: one row per event; per-user read state lives in notification_reads.
create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  type            public.notification_type not null,
  priority        text not null default 'normal' check (priority in ('alta', 'normal', 'baja')),
  title           text not null,
  body            text,
  entity_type     text,
  entity_id       uuid,
  payload         jsonb not null default '{}',
  recipient_role  public.team_role,
  created_at      timestamptz not null default now()
);

create index notifications_project_created_idx on public.notifications (project_id, created_at desc);

create table public.notification_reads (
  notification_id  uuid not null references public.notifications (id) on delete cascade,
  profile_id       uuid not null references public.profiles (id) on delete cascade,
  read_at          timestamptz not null default now(),
  primary key (notification_id, profile_id)
);

-- Transactional outbox: external deliveries (email now, whatsapp later) are queued in the
-- same transaction as the business event — an email can never exist for a rolled-back reservation.
create table public.notification_outbox (
  id               uuid primary key default gen_random_uuid(),
  notification_id  uuid references public.notifications (id) on delete cascade,
  channel          text not null default 'email' check (channel in ('email', 'whatsapp')),
  recipient        text not null,
  template         text not null,
  payload          jsonb not null default '{}',
  status           text not null default 'pendiente' check (status in ('pendiente', 'enviado', 'fallido')),
  attempts         int not null default 0,
  last_error       text,
  sent_at          timestamptz,
  created_at       timestamptz not null default now()
);

create index notification_outbox_pending_idx on public.notification_outbox (created_at)
  where status = 'pendiente';

-- project_id NULL = global default; a per-project row overrides it.
create table public.settings (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references public.projects (id) on delete cascade,
  key         text not null,
  value       jsonb not null,
  is_public   boolean not null default false,
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now(),
  unique nulls not distinct (project_id, key)
);

-- Append-only. UPDATE/DELETE revoked from every client role in the RLS migration.
create table public.audit_log (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  actor_type   public.actor_type not null,
  actor_id     uuid,
  actor_label  text,
  action       text not null,
  project_id   uuid,
  entity_type  text,
  entity_id    uuid,
  before       jsonb,
  after        jsonb,
  ip_hash      text
);

create index audit_log_project_idx on public.audit_log (project_id, occurred_at desc);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);
