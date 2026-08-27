-- Una venta también puede estar a nombre de un tercero.
--
-- Hasta acá el titular vivía sólo en los egresos y los comprobantes, y las
-- ventas se asumían siempre de la empresa. En este negocio no siempre lo son:
-- hay lotes que se venden a nombre de un socio y esa venta no se declara con
-- las demás. Sin este dato, la importación al libro fiscal se las llevaba a
-- todas por igual.

alter table public.reservations
  add column if not exists titular text not null default 'empresa',
  add column if not exists titular_nombre text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reservations_titular_check') then
    alter table public.reservations add constraint reservations_titular_check
      check (titular in ('empresa','tercero'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reservations_tercero_con_nombre') then
    alter table public.reservations add constraint reservations_tercero_con_nombre
      check (titular <> 'tercero' or btrim(coalesce(titular_nombre,'')) <> '');
  end if;
end $$;

create index if not exists reservations_titular_idx
  on public.reservations(titular) where titular = 'tercero';

-- Poner o sacar el titular de una venta. Vale para las que ya existen: el
-- dato es nuevo y las ventas viejas no se van a volver a cargar a mano.
create or replace function public.admin_asignar_titular(
  p_reservation_id uuid,
  p_titular text,
  p_titular_nombre text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_actor uuid;
  v_res public.reservations%rowtype;
  v_titular text;
  v_nombre text;
begin
  v_actor := private.assert_accounting();

  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;

  v_titular := coalesce(nullif(btrim(coalesce(p_titular, '')), ''), 'empresa');
  if v_titular not in ('empresa','tercero') then raise exception 'TITULAR_INVALIDO'; end if;
  v_nombre := nullif(btrim(coalesce(p_titular_nombre, '')), '');
  if v_titular = 'tercero' and v_nombre is null then
    raise exception 'TITULAR_SIN_NOMBRE'
      using detail = 'Si la venta está a nombre de un tercero, hay que decir de quién.';
  end if;
  if v_titular = 'empresa' then v_nombre := null; end if;

  update public.reservations
     set titular = v_titular, titular_nombre = v_nombre, updated_at = now()
   where id = p_reservation_id;

  perform private.audit('team', v_actor, null, 'venta.titular', v_res.project_id,
    'reservation', p_reservation_id,
    jsonb_build_object('titular', v_res.titular, 'nombre', v_res.titular_nombre),
    jsonb_build_object('titular', v_titular, 'nombre', v_nombre));

  return jsonb_build_object('ok', true, 'titular', v_titular, 'titular_nombre', v_nombre);
end;
$$;

grant execute on function public.admin_asignar_titular(uuid, text, text) to authenticated;
revoke execute on function public.admin_asignar_titular(uuid, text, text) from anon;
