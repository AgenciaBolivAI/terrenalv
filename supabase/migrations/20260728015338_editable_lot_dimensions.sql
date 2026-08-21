alter table public.lots drop constraint if exists lots_frontage_m_max_check;
alter table public.lots add constraint lots_frontage_m_max_check
  check (frontage_m is null or frontage_m <= 1000);

alter table public.lots drop constraint if exists lots_depth_m_max_check;
alter table public.lots add constraint lots_depth_m_max_check
  check (depth_m is null or depth_m <= 1000);

grant update (frontage_m, depth_m) on public.lots to authenticated;

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
     or (old.deleted_at is distinct from new.deleted_at)
     or (old.frontage_m is distinct from new.frontage_m)
     or (old.depth_m is distinct from new.depth_m) then
    perform private.audit(
      case when auth.uid() is not null then 'team'::public.actor_type
           else 'system'::public.actor_type end,
      auth.uid(), null, 'lot.changed', new.project_id, 'lot', new.id,
      jsonb_build_object('status', old.status, 'price_override', old.price_override,
                         'category_id', old.category_id, 'deleted_at', old.deleted_at,
                         'frontage_m', old.frontage_m, 'depth_m', old.depth_m),
      jsonb_build_object('status', new.status, 'price_override', new.price_override,
                         'category_id', new.category_id, 'deleted_at', new.deleted_at,
                         'frontage_m', new.frontage_m, 'depth_m', new.depth_m));
  end if;
  return new;
end;
$$;
