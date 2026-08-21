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

drop policy if exists projects_public_read on public.projects;
drop policy if exists projects_team_read   on public.projects;

create policy projects_anon_read on public.projects
  for select to anon
  using (status = 'activo');

create policy projects_read on public.projects
  for select to authenticated
  using (private.is_team() or status = 'activo');

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

drop policy if exists plano_sheets_admin_write on public.plano_sheets;

create policy plano_sheets_admin_insert on public.plano_sheets
  for insert to authenticated with check (private.is_admin());
create policy plano_sheets_admin_update on public.plano_sheets
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy plano_sheets_admin_delete on public.plano_sheets
  for delete to authenticated using (private.is_admin());

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

create index if not exists lots_category_idx on public.lots (category_id) where deleted_at is null;
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

create index if not exists payments_verified_idx on public.payments (project_id, verified_at)
  where status = 'aprobado';

alter function private.rounded_rect_ring(numeric, numeric, numeric, numeric, numeric, integer)
  set search_path = public, private, extensions, pg_temp;
