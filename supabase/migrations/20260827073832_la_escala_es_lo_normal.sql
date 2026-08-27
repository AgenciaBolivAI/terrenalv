-- Al asignarle el vendedor a una venta, la comisión sale de la escala del
-- Directorio salvo que alguien escriba un % a mano — y escribirlo a mano es,
-- justamente, decir «esta venta va por fuera de la escala».

create or replace function public.admin_asignar_vendedor(
  p_reservation_id uuid,
  p_profile_id uuid,
  p_pct numeric default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_actor uuid;
  v_res public.reservations%rowtype;
  v_regla jsonb;
  v_pct numeric;
  v_base text;
  v_antes uuid;
  v_hay_escala boolean;
begin
  v_actor := private.assert_accounting();

  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  v_antes := v_res.sold_by;

  if p_profile_id is not null
     and not exists (select 1 from public.profiles where id = p_profile_id and is_active) then
    raise exception 'EMPLEADO_NO_ENCONTRADO';
  end if;
  if p_pct is not null and (p_pct < 0 or p_pct > 100) then raise exception 'PCT_INVALIDO'; end if;

  if p_profile_id is null then
    -- Quitar el vendedor: la venta queda sin comisión asignada.
    update public.reservations
       set sold_by = null, commission_pct = null, commission_base = null, updated_at = now()
     where id = p_reservation_id;
    v_pct := null; v_base := null;
  else
    -- ¿Hay escala vigente para la gestión de esta venta?
    select exists (
      select 1 from public.commission_scales e
       where e.is_active
         and e.gestion = extract(year from (coalesce(v_res.confirmed_at, now())
                                            at time zone 'America/La_Paz'))::int)
      into v_hay_escala;

    v_regla := public.regla_de_comision(v_res.project_id, p_profile_id);

    if p_pct is not null then
      -- Un % escrito a mano manda, y saca a esta venta de la escala.
      v_pct  := p_pct;
      v_base := case when coalesce(v_res.commission_base, '') = 'escala'
                     then 'cobrado'
                     else coalesce(v_res.commission_base, v_regla->>'base', 'cobrado') end;
    elsif v_res.commission_base is not null then
      v_base := v_res.commission_base;
      v_pct  := coalesce(v_res.commission_pct, (v_regla->>'pct')::numeric, 0);
    elsif v_regla ? 'base' then
      v_base := v_regla->>'base';
      v_pct  := coalesce((v_regla->>'pct')::numeric, 0);
    elsif v_hay_escala then
      -- Lo normal: la escala del Directorio.
      v_base := 'escala';
      v_pct  := 0;
    else
      v_base := 'cobrado';
      v_pct  := 0;
    end if;

    update public.reservations
       set sold_by = p_profile_id, commission_pct = v_pct, commission_base = v_base,
           updated_at = now()
     where id = p_reservation_id;
  end if;

  perform private.audit('team', v_actor, null, 'venta.vendedor_asignado', v_res.project_id,
    'reservation', p_reservation_id,
    jsonb_build_object('vendedor_anterior', v_antes),
    jsonb_build_object('vendedor', p_profile_id, 'pct', v_pct, 'base', v_base));

  return jsonb_build_object('ok', true, 'pct', v_pct, 'base', v_base);
end;
$$;

-- Volver una venta a la escala después de haberla puesto a mano.
create or replace function public.admin_comision_a_escala(p_reservation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid;
begin
  v_actor := private.assert_accounting();
  update public.reservations
     set commission_base = 'escala', commission_pct = 0, updated_at = now()
   where id = p_reservation_id and sold_by is not null;
  if not found then
    raise exception 'VENTA_SIN_VENDEDOR'
      using detail = 'Primero asignale un vendedor a la venta.';
  end if;
  perform private.audit('team', v_actor, null, 'venta.comision_escala', null,
    'reservation', p_reservation_id, null, jsonb_build_object('base', 'escala'));
  return jsonb_build_object('ok', true, 'base', 'escala');
end;
$$;

grant execute on function public.admin_comision_a_escala(uuid) to authenticated;
revoke execute on function public.admin_comision_a_escala(uuid) from anon;
