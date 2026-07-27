-- Realtime broadcast triggers, delete guards, and row-level audit triggers.

-- Public lot-status broadcast: tiny payload, zero PII, no hold timing (snipers
-- learn nothing). status_rev is monotonic per project; clients refetch the status
-- snapshot when they detect a gap (tab sleep / reconnect).
create or replace function private.tg_broadcast_lot_status()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_rev bigint;
begin
  update public.projects
     set status_rev = status_rev + 1
   where id = new.project_id
  returning status_rev into v_rev;

  perform realtime.send(
    jsonb_build_object('lot_id', new.id, 'status', new.status, 'status_rev', v_rev),
    'lot_status',
    'project:' || new.project_id || ':lots',
    false  -- public topic
  );
  return new;
end;
$$;

create trigger broadcast_lot_status
  after update of status on public.lots
  for each row
  when (old.status is distinct from new.status)
  execute function private.tg_broadcast_lot_status();

-- Team notification bell: broadcast the pointer on a private topic; the client
-- fetches the row itself (RLS-checked).
create or replace function private.tg_broadcast_notification()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  perform realtime.send(
    jsonb_build_object('id', new.id, 'type', new.type, 'title', new.title,
                       'priority', new.priority),
    'notification',
    'team:' || new.project_id,
    true  -- private topic, authorized via RLS on realtime.messages
  );
  return new;
end;
$$;

create trigger broadcast_notification
  after insert on public.notifications
  for each row execute function private.tg_broadcast_notification();

-- No physical deletes once a lot has reservation history — soft-delete instead.
-- Fires for direct deletes AND cascades from a manzana delete.
create or replace function private.tg_guard_lot_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.reservations r where r.lot_id = old.id) then
    raise exception 'LOT_HAS_HISTORY: use soft-delete (deleted_at) para el lote %', old.number;
  end if;
  return old;
end;
$$;

create trigger guard_lot_delete
  before delete on public.lots
  for each row execute function private.tg_guard_lot_delete();

-- Audit business-sensitive lot changes (price/category/status/soft-delete).
-- Geometry edits are audited at the RPC level ('lots.saved') to avoid noise.
create or replace function private.tg_audit_lot_change()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if (old.status is distinct from new.status)
     or (old.price_override is distinct from new.price_override)
     or (old.category_id is distinct from new.category_id)
     or (old.deleted_at is distinct from new.deleted_at) then
    perform private.audit(
      case when auth.uid() is not null then 'team'::public.actor_type
           else 'system'::public.actor_type end,
      auth.uid(), null, 'lot.changed', new.project_id, 'lot', new.id,
      jsonb_build_object('status', old.status, 'price_override', old.price_override,
                         'category_id', old.category_id, 'deleted_at', old.deleted_at),
      jsonb_build_object('status', new.status, 'price_override', new.price_override,
                         'category_id', new.category_id, 'deleted_at', new.deleted_at));
  end if;
  return new;
end;
$$;

create trigger audit_lot_change
  after update on public.lots
  for each row execute function private.tg_audit_lot_change();

create or replace function private.tg_audit_pricing_category()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  perform private.audit(
    case when auth.uid() is not null then 'team'::public.actor_type
         else 'system'::public.actor_type end,
    auth.uid(), null,
    'pricing_category.' || lower(tg_op),
    coalesce(new.project_id, old.project_id), 'pricing_category', coalesce(new.id, old.id),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('UPDATE', 'INSERT') then to_jsonb(new) end);
  return coalesce(new, old);
end;
$$;

create trigger audit_pricing_category
  after insert or update or delete on public.pricing_categories
  for each row execute function private.tg_audit_pricing_category();

-- Defense-in-depth: role/is_active changes only through set_team_member (definer,
-- runs as owner) or service_role tooling — never through a direct client update.
create or replace function private.tg_guard_profile_privilege()
returns trigger
language plpgsql
set search_path = public, private
as $$
begin
  if (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
     and current_user not in ('postgres', 'service_role', 'supabase_admin')
     and not private.is_admin() then
    raise exception 'NO_AUTORIZADO';
  end if;
  return new;
end;
$$;

create trigger guard_profile_privilege
  before update on public.profiles
  for each row execute function private.tg_guard_profile_privilege();
