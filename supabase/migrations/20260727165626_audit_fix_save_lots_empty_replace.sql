-- 8. DESTRUCTIVE BUILDER SAVE (alta, server-side guard): save_lots with
--    p_replace_missing and an empty payload soft-deleted an entire manzana when
--    the client's lot query was still in flight or had failed.
create or replace function public.save_lots(
  p_manzana_id uuid,
  p_lots jsonb,
  p_replace_missing boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_actor uuid;
  v_mz public.manzanas%rowtype;
  v_item jsonb;
  v_geom extensions.geometry;
  v_numbers text[] := '{}';
  v_lot public.lots%rowtype;
  v_upserted int := 0;
  v_locked text[] := '{}';
  v_live int;
  a record;
begin
  v_actor := private.assert_admin();

  select * into v_mz from public.manzanas where id = p_manzana_id;
  if not found then raise exception 'MANZANA_NOT_FOUND'; end if;
  if v_mz.geom is null then raise exception 'MANZANA_HAS_NO_GEOMETRY'; end if;

  -- Never let an empty payload wipe a populated manzana (client load race).
  if p_replace_missing and jsonb_array_length(coalesce(p_lots, '[]'::jsonb)) = 0 then
    select count(*) into v_live from public.lots
    where manzana_id = p_manzana_id and deleted_at is null;
    if v_live > 0 then
      raise exception 'EMPTY_REPLACE_BLOCKED';
    end if;
  end if;

  create temp table tmp_new_lots (
    number text primary key,
    geom extensions.geometry,
    frontage_m numeric, depth_m numeric, area_m2 numeric,
    is_corner boolean, is_manual_geom boolean, edge_dims jsonb, needs_review boolean
  ) on commit drop;

  for v_item in select * from jsonb_array_elements(p_lots) loop
    v_geom := private.ring_to_geom(v_item->'ring');
    if not extensions.st_within(v_geom, extensions.st_buffer(v_mz.geom, 0.05)) then
      raise exception 'LOT_OUTSIDE_MANZANA: %', v_item->>'number';
    end if;
    insert into tmp_new_lots values (
      v_item->>'number', v_geom,
      (v_item->>'frontage_m')::numeric, (v_item->>'depth_m')::numeric,
      (v_item->>'area_m2')::numeric,
      coalesce((v_item->>'is_corner')::boolean, false),
      coalesce((v_item->>'is_manual_geom')::boolean, false),
      v_item->'edge_dims',
      coalesce((v_item->>'needs_review')::boolean, false)
    );
    v_numbers := array_append(v_numbers, v_item->>'number');
  end loop;

  for a in
    select l1.number as n1, l2.number as n2
    from tmp_new_lots l1
    join tmp_new_lots l2 on l1.number < l2.number
      and l1.geom && l2.geom
      and extensions.st_area(extensions.st_intersection(l1.geom, l2.geom)) > 0.05
    limit 5
  loop
    raise exception 'LOTS_OVERLAP: % y %', a.n1, a.n2;
  end loop;

  select array_agg(l.number) into v_locked
  from public.lots l
  join tmp_new_lots t on t.number = l.number
  where l.manzana_id = p_manzana_id and l.deleted_at is null
    and not extensions.st_equals(l.geom, t.geom)
    and (l.status <> 'disponible'
         or exists (select 1 from public.reservations r where r.lot_id = l.id));
  if v_locked is not null and array_length(v_locked, 1) > 0 then
    raise exception 'LOTS_GEOMETRY_LOCKED: %', array_to_string(v_locked, ', ');
  end if;

  for a in select * from tmp_new_lots loop
    select * into v_lot from public.lots
    where manzana_id = p_manzana_id and number = a.number and deleted_at is null;
    if found then
      update public.lots
         set geom = a.geom, frontage_m = a.frontage_m, depth_m = a.depth_m,
             area_m2 = coalesce(a.area_m2, area_m2),
             is_corner = a.is_corner, is_manual_geom = a.is_manual_geom,
             edge_dims = a.edge_dims, needs_review = a.needs_review,
             state = 'draft', version = version + 1
       where id = v_lot.id;
    else
      insert into public.lots
        (project_id, manzana_id, number, geom, frontage_m, depth_m, area_m2,
         is_corner, is_manual_geom, edge_dims, needs_review, state)
      values
        (v_mz.project_id, p_manzana_id, a.number, a.geom, a.frontage_m, a.depth_m,
         coalesce(a.area_m2, round(extensions.st_area(a.geom)::numeric, 2)),
         a.is_corner, a.is_manual_geom, a.edge_dims, a.needs_review, 'draft');
    end if;
    v_upserted := v_upserted + 1;
  end loop;

  if p_replace_missing then
    if exists (
      select 1 from public.lots l
      where l.manzana_id = p_manzana_id and l.deleted_at is null
        and not (l.number = any(v_numbers))
        and (l.status <> 'disponible'
             or exists (select 1 from public.reservations r where r.lot_id = l.id))
    ) then
      raise exception 'LOTS_GEOMETRY_LOCKED: no se pueden eliminar lotes con historial';
    end if;
    update public.lots set deleted_at = now(), state = 'draft'
     where manzana_id = p_manzana_id and deleted_at is null
       and not (number = any(v_numbers));
  end if;

  update public.manzanas set state = 'draft' where id = p_manzana_id;

  perform private.audit('team', v_actor, null, 'lots.saved', v_mz.project_id,
    'manzana', p_manzana_id, null,
    jsonb_build_object('cantidad', v_upserted, 'reemplazo', p_replace_missing));

  return jsonb_build_object('upserted', v_upserted);
end;
$$;

revoke execute on function public.save_lots(uuid, jsonb, boolean) from public, anon;
grant execute on function public.save_lots(uuid, jsonb, boolean) to authenticated, service_role;
