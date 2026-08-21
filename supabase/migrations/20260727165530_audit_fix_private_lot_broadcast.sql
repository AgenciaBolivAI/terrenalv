-- 4. SPOOFABLE PUBLIC REALTIME (alta): the lots topic was non-private, so anyone
--    with the anon key could broadcast fake 'vendido' for every lot. Make the
--    topic private: clients may RECEIVE (SELECT policy) but never PUBLISH
--    (no INSERT policy).
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
    true  -- private topic: receive requires the policy below, publishing is impossible
  );
  return new;
end;
$$;

drop policy if exists project_broadcast_read on realtime.messages;
create policy project_broadcast_read on realtime.messages
  for select to anon, authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and split_part((select realtime.topic()), ':', 1) = 'project'
  );
