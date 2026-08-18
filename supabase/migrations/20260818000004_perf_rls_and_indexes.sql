-- Performance pass, driven by the Supabase database linter.
--
-- Three real problems, all of them per-row costs on the hottest read in the
-- app — the public map, which selects 2.078 lots plus their manzanas and
-- elements on every visit.
--
-- 1. Two permissive SELECT policies on the same table for `authenticated`.
--    Permissive policies OR together, so Postgres evaluates BOTH for every row
--    before it can decide. Merging them into one is exactly equivalent and
--    halves that work. The anon-facing policy is kept, scoped to anon only.
--
-- 2. auth.uid() called per row instead of once. Wrapping it in a scalar
--    subquery makes the planner hoist it to an InitPlan.
--
-- 3. Foreign keys with no covering index. Every one of these is a column the
--    app actually joins or filters on.
--
-- Nothing here changes who can read what. Each merged policy is the OR of the
-- two it replaces, which is what the two of them already meant together.

-- ============================================================================
-- 1. Merge the double SELECT policies
-- ============================================================================

-- lots -----------------------------------------------------------------------
drop policy if exists lots_public_read on public.lots;
drop policy if exists lots_team_read   on public.lots;

create policy lots_anon_read on public.lots
  for select to anon
  using (
    state = 'published'
    and deleted_at is null
    and exists (select 1 from public.projects p where p.id = lots.project_id and p.status = 'activo')
  );

create policy lots_read on public.lots
  for select to authenticated
  using (
    private.is_team()
    or (
      state = 'published'
      and deleted_at is null
      and exists (select 1 from public.projects p where p.id = lots.project_id and p.status = 'activo')
    )
  );

-- manzanas -------------------------------------------------------------------
drop policy if exists manzanas_public_read on public.manzanas;
drop policy if exists manzanas_team_read   on public.manzanas;

create policy manzanas_anon_read on public.manzanas
  for select to anon
  using (
    state = 'published'
    and exists (select 1 from public.projects p where p.id = manzanas.project_id and p.status = 'activo')
  );

create policy manzanas_read on public.manzanas
  for select to authenticated
  using (
    private.is_team()
    or (
      state = 'published'
      and exists (select 1 from public.projects p where p.id = manzanas.project_id and p.status = 'activo')
    )
  );

-- map_elements ---------------------------------------------------------------
drop policy if exists elements_public_read on public.map_elements;
drop policy if exists elements_team_read   on public.map_elements;

create policy elements_anon_read on public.map_elements
  for select to anon
  using (
    state = 'published'
    and exists (select 1 from public.projects p where p.id = map_elements.project_id and p.status = 'activo')
  );

create policy elements_read on public.map_elements
  for select to authenticated
  using (
    private.is_team()
    or (
      state = 'published'
      and exists (select 1 from public.projects p where p.id = map_elements.project_id and p.status = 'activo')
    )
  );

-- pricing_categories ---------------------------------------------------------
-- Three overlapping policies here: the admin one was FOR ALL, which includes
-- SELECT. Admins are team members, so team read already covers them; the write
-- policy only needs the write commands.
drop policy if exists categories_public_read on public.pricing_categories;
drop policy if exists categories_team_read   on public.pricing_categories;
drop policy if exists categories_admin_write on public.pricing_categories;

create policy categories_anon_read on public.pricing_categories
  for select to anon
  using (exists (select 1 from public.projects p where p.id = pricing_categories.project_id and p.status = 'activo'));

create policy categories_read on public.pricing_categories
  for select to authenticated
  using (
    private.is_team()
    or exists (select 1 from public.projects p where p.id = pricing_categories.project_id and p.status = 'activo')
  );

create policy categories_admin_insert on public.pricing_categories
  for insert to authenticated with check (private.is_admin());
create policy categories_admin_update on public.pricing_categories
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy categories_admin_delete on public.pricing_categories
  for delete to authenticated using (private.is_admin());

-- projects -------------------------------------------------------------------
drop policy if exists projects_public_read on public.projects;
drop policy if exists projects_team_read   on public.projects;

create policy projects_anon_read on public.projects
  for select to anon
  using (status = 'activo');

create policy projects_read on public.projects
  for select to authenticated
  using (private.is_team() or status = 'activo');

-- settings -------------------------------------------------------------------
-- The cron secret stays admin-only: the merged condition is the OR of what the
-- two policies already granted together, guard included.
drop policy if exists settings_public_read on public.settings;
drop policy if exists settings_team_read   on public.settings;

create policy settings_anon_read on public.settings
  for select to anon
  using (is_public);

create policy settings_read on public.settings
  for select to authenticated
  using (
    is_public
    or (private.is_team() and (key <> 'internal_cron_secret' or private.is_admin()))
  );

-- plano_sheets ---------------------------------------------------------------
-- Same FOR ALL overlap as pricing_categories.
drop policy if exists plano_sheets_admin_write on public.plano_sheets;

create policy plano_sheets_admin_insert on public.plano_sheets
  for insert to authenticated with check (private.is_admin());
create policy plano_sheets_admin_update on public.plano_sheets
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy plano_sheets_admin_delete on public.plano_sheets
  for delete to authenticated using (private.is_admin());

-- ============================================================================
-- 2. Hoist auth.uid() out of the per-row loop
-- ============================================================================
drop policy if exists notifications_team_read on public.notifications;
create policy notifications_team_read on public.notifications
  for select to authenticated
  using (
    private.is_team()
    and (
      recipient_role is null
      or recipient_role = (select role from public.profiles where id = (select auth.uid()))
    )
  );

drop policy if exists reads_own_select on public.notification_reads;
create policy reads_own_select on public.notification_reads
  for select to authenticated using (profile_id = (select auth.uid()));

drop policy if exists reads_own_insert on public.notification_reads;
create policy reads_own_insert on public.notification_reads
  for insert to authenticated
  with check (profile_id = (select auth.uid()) and private.is_team());

drop policy if exists reads_own_delete on public.notification_reads;
create policy reads_own_delete on public.notification_reads
  for delete to authenticated using (profile_id = (select auth.uid()));

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ============================================================================
-- 3. Covering indexes for foreign keys the app actually joins on
-- ============================================================================
-- lots.category_id: every price on the map resolves through this.
create index if not exists lots_category_idx on public.lots (category_id) where deleted_at is null;
-- lots.active_reservation_id: the lot -> reservation hop in /admin/lotes.
create index if not exists lots_active_reservation_idx on public.lots (active_reservation_id)
  where active_reservation_id is not null;
create index if not exists payments_project_idx on public.payments (project_id);
create index if not exists payments_verified_by_idx on public.payments (verified_by) where verified_by is not null;
create index if not exists reservations_verified_by_idx on public.reservations (verified_by) where verified_by is not null;
create index if not exists settings_updated_by_idx on public.settings (updated_by) where updated_by is not null;
create index if not exists notification_reads_profile_idx on public.notification_reads (profile_id);
create index if not exists notification_outbox_notification_idx on public.notification_outbox (notification_id);
create index if not exists expenses_created_by_idx on public.expenses (created_by) where created_by is not null;
create index if not exists installment_plans_created_by_idx on public.installment_plans (created_by) where created_by is not null;

-- The reporting read: approved payments in a month, which the cashflow view runs
-- on every load of /admin/contabilidad.
create index if not exists payments_verified_idx on public.payments (project_id, verified_at)
  where status = 'aprobado';

-- ============================================================================
-- 4. Pin the search_path on the one function missing it
-- ============================================================================
-- A function without a fixed search_path can be pointed at attacker-controlled
-- objects by whoever calls it. Everything else in this database already sets it.
alter function private.rounded_rect_ring(numeric, numeric, numeric, numeric, numeric, integer)
  set search_path = public, private, extensions, pg_temp;
