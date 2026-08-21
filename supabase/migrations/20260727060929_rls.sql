-- Row Level Security, baseline grants, storage buckets/policies, realtime authorization.
--
-- Principles:
--  * Tables anon can read contain ZERO buyer PII by design (a frontend "select *"
--    bug cannot leak anything).
--  * reservations / payments have NO anon policies at all; guests go through
--    service-role RPCs exclusively.
--  * All state transitions live in SECURITY DEFINER RPCs; clients get narrow
--    column-level write grants only where direct edits are safe (admin inline edits).

-- ============================================================================
-- Enable RLS everywhere (NOT forced: definer functions run as the table owner).
-- ============================================================================
alter table public.projects enable row level security;
alter table public.pricing_categories enable row level security;
alter table public.manzanas enable row level security;
alter table public.map_elements enable row level security;
alter table public.plano_sheets enable row level security;
alter table public.lots enable row level security;
alter table public.reservations enable row level security;
alter table public.payments enable row level security;
alter table public.profiles enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_reads enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.settings enable row level security;
alter table public.audit_log enable row level security;

-- ============================================================================
-- Baseline grants: anon is read-only at the GRANT level before policies even run;
-- authenticated writes are revoked wholesale and granted back narrowly.
-- ============================================================================
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public from anon;
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public from authenticated;

-- Narrow write grants (rows still gated by the policies below):
grant insert, delete on public.notification_reads to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;
grant update (category_id, price_override, needs_review) on public.lots to authenticated;
grant insert, update, delete on public.pricing_categories to authenticated;
grant update (name, description, location_text, status, currency, tracking_prefix,
              utm_offset_e, utm_offset_n, plan_to_utm)
  on public.projects to authenticated;
grant update (sector, kind, notes, needs_review, label_anchor) on public.manzanas to authenticated;
grant insert, update, delete on public.plano_sheets to authenticated;

-- audit_log is append-only for everyone but the definer functions.
revoke insert, update, delete on public.audit_log from anon, authenticated;

-- ============================================================================
-- SELECT policies
-- ============================================================================
create policy projects_public_read on public.projects
  for select to anon, authenticated
  using (status = 'activo');
create policy projects_team_read on public.projects
  for select to authenticated
  using (private.is_team());

create policy categories_public_read on public.pricing_categories
  for select to anon, authenticated
  using (exists (select 1 from public.projects p
                 where p.id = project_id and p.status = 'activo'));
create policy categories_team_read on public.pricing_categories
  for select to authenticated
  using (private.is_team());

create policy manzanas_public_read on public.manzanas
  for select to anon, authenticated
  using (state = 'published'
         and exists (select 1 from public.projects p
                     where p.id = project_id and p.status = 'activo'));
create policy manzanas_team_read on public.manzanas
  for select to authenticated
  using (private.is_team());

create policy lots_public_read on public.lots
  for select to anon, authenticated
  using (state = 'published' and deleted_at is null
         and exists (select 1 from public.projects p
                     where p.id = project_id and p.status = 'activo'));
create policy lots_team_read on public.lots
  for select to authenticated
  using (private.is_team());

create policy elements_public_read on public.map_elements
  for select to anon, authenticated
  using (state = 'published'
         and exists (select 1 from public.projects p
                     where p.id = project_id and p.status = 'activo'));
create policy elements_team_read on public.map_elements
  for select to authenticated
  using (private.is_team());

create policy plano_sheets_team_read on public.plano_sheets
  for select to authenticated
  using (private.is_team());

-- PII tables: team-only visibility. No anon policies exist — invisible.
create policy reservations_team_read on public.reservations
  for select to authenticated
  using (private.is_team());

create policy payments_team_read on public.payments
  for select to authenticated
  using (private.is_team());

create policy profiles_team_read on public.profiles
  for select to authenticated
  using (private.is_team());

create policy notifications_team_read on public.notifications
  for select to authenticated
  using (private.is_team()
         and (recipient_role is null
              or recipient_role = (select role from public.profiles where id = auth.uid())));

create policy outbox_admin_read on public.notification_outbox
  for select to authenticated
  using (private.is_admin());

create policy settings_public_read on public.settings
  for select to anon, authenticated
  using (is_public);
create policy settings_team_read on public.settings
  for select to authenticated
  using (private.is_team());

create policy audit_admin_read on public.audit_log
  for select to authenticated
  using (private.is_admin());

-- ============================================================================
-- Write policies (paired with the narrow column grants above)
-- ============================================================================
create policy reads_own_insert on public.notification_reads
  for insert to authenticated
  with check (profile_id = auth.uid() and private.is_team());
create policy reads_own_select on public.notification_reads
  for select to authenticated
  using (profile_id = auth.uid());
create policy reads_own_delete on public.notification_reads
  for delete to authenticated
  using (profile_id = auth.uid());

create policy profiles_self_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy lots_admin_update on public.lots
  for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());

create policy categories_admin_write on public.pricing_categories
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

create policy projects_admin_update on public.projects
  for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());

create policy manzanas_admin_update on public.manzanas
  for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());

create policy plano_sheets_admin_write on public.plano_sheets
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

-- ============================================================================
-- Storage buckets + policies
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('maps', 'maps', true, 10485760, null),
  ('planos', 'planos', false, 26214400, array['image/jpeg', 'image/png', 'image/webp']),
  ('bank-assets', 'bank-assets', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('payment-proofs', 'payment-proofs', false, 5242880,
     array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- maps: world-readable (public bucket), admin-writable.
create policy maps_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'maps');
create policy maps_admin_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'maps' and private.is_admin());
create policy maps_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'maps' and private.is_admin());
create policy maps_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'maps' and private.is_admin());

-- planos: Builder underlay — team read, admin write.
create policy planos_team_read on storage.objects
  for select to authenticated
  using (bucket_id = 'planos' and private.is_team());
create policy planos_admin_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'planos' and private.is_admin());
create policy planos_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'planos' and private.is_admin());

-- bank-assets (the business QR image): team read; guests receive short-TTL signed
-- URLs minted server-side. Admin write.
create policy bank_assets_team_read on storage.objects
  for select to authenticated
  using (bucket_id = 'bank-assets' and private.is_team());
create policy bank_assets_admin_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'bank-assets' and private.is_admin());
create policy bank_assets_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'bank-assets' and private.is_admin());
create policy bank_assets_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'bank-assets' and private.is_admin());

-- payment-proofs: NO anon policies whatsoever. Guests upload only via the
-- server-proxied route (service key — bypasses RLS) with a server-chosen path.
-- Team reads; admin deletes.
create policy proofs_team_read on storage.objects
  for select to authenticated
  using (bucket_id = 'payment-proofs' and private.is_team());
create policy proofs_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'payment-proofs' and private.is_admin());

-- ============================================================================
-- Realtime: private team topics require team membership. Public lot topics
-- (project:{id}:lots) are non-private and need no policy.
-- ============================================================================
create policy team_broadcast_read on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and split_part((select realtime.topic()), ':', 1) = 'team'
    and private.is_team()
  );
