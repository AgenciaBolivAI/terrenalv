-- Quién vendió, y cuánto le toca.
--
-- Hasta ahora la única persona pegada a una venta era `verified_by`: quien
-- APROBÓ el pago. No es lo mismo que quien la vendió — el pago lo aprueba
-- contabilidad y la venta la cierra el vendedor, y con eso no se puede pagar
-- una comisión a nadie.
--
-- La comisión se congela AL VENDER: si mañana la empresa cambia el porcentaje,
-- las ventas ya hechas conservan el que se pactó. Cambiarlo hacia atrás sería
-- reescribirle el sueldo a alguien.
--
-- Se GANA a medida que el comprador paga, no de golpe al firmar: sobre una
-- venta a 120 meses, reconocer toda la comisión el primer día sería pagar
-- sobre plata que todavía no entró. La regla dice cuál de las dos bases usa.

alter table public.reservations
  add column if not exists sold_by uuid references public.profiles (id) on delete set null,
  add column if not exists commission_pct numeric(5,2)
    check (commission_pct is null or (commission_pct >= 0 and commission_pct <= 100)),
  add column if not exists commission_base text
    check (commission_base is null or commission_base in ('precio', 'cobrado'));

create index if not exists reservations_sold_by_idx on public.reservations (sold_by)
  where sold_by is not null;

-- ---- Las reglas: qué porcentaje le toca a quién.
create table if not exists public.commission_rules (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references public.projects (id) on delete cascade,
  -- null = vale para todo el equipo; con perfil = solo para esa persona.
  profile_id  uuid references public.profiles (id) on delete cascade,
  nombre      text not null check (btrim(nombre) <> ''),
  pct         numeric(5,2) not null check (pct >= 0 and pct <= 100),
  -- 'precio': sobre el precio del lote. 'cobrado': sobre lo que el comprador
  -- va pagando (capital, sin intereses) — se gana de a poco.
  base        text not null default 'cobrado' check (base in ('precio', 'cobrado')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.commission_rules enable row level security;
revoke all on public.commission_rules from anon, authenticated;
grant select on public.commission_rules to authenticated;
create policy comisiones_equipo_lee on public.commission_rules
  for select to authenticated using (private.is_team());

drop trigger if exists set_updated_at on public.commission_rules;
create trigger set_updated_at before update on public.commission_rules
  for each row execute function private.tg_set_updated_at();

-- Punto de partida: 3% sobre lo cobrado, para todo el equipo.
insert into public.commission_rules (project_id, profile_id, nombre, pct, base)
select null, null, 'Comisión general de ventas', 3, 'cobrado'
 where not exists (select 1 from public.commission_rules);

-- ---- Qué regla le toca a una persona en una urbanización. Gana la más
--      específica: la del vendedor por proyecto, después la del vendedor,
--      después la del proyecto, y al final la general.
create or replace function public.regla_de_comision(p_project_id uuid, p_profile_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, private, extensions, pg_temp
as $$
  select case when r.id is null then null else jsonb_build_object(
           'rule_id', r.id, 'nombre', r.nombre, 'pct', r.pct, 'base', r.base) end
    from (
      select t.* from public.commission_rules t
       where t.is_active
         and (t.project_id = p_project_id or t.project_id is null)
         and (t.profile_id = p_profile_id or t.profile_id is null)
       order by (t.profile_id is not null) desc, (t.project_id is not null) desc
       limit 1
    ) r;
$$;

revoke execute on function public.regla_de_comision(uuid, uuid) from public, anon;
grant execute on function public.regla_de_comision(uuid, uuid) to authenticated, service_role;

-- ---- Asignar (o corregir) el vendedor de una venta o reserva.
create or replace function public.admin_asignar_vendedor(
  p_reservation_id uuid,
  p_profile_id uuid,
  p_pct numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid; v_res public.reservations%rowtype; v_regla jsonb;
  v_pct numeric; v_base text; v_antes uuid;
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
    v_regla := public.regla_de_comision(v_res.project_id, p_profile_id);
    v_pct := coalesce(p_pct, (v_regla->>'pct')::numeric, 0);
    v_base := coalesce(v_res.commission_base, v_regla->>'base', 'cobrado');
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
$fn$;

revoke execute on function public.admin_asignar_vendedor(uuid, uuid, numeric) from public, anon;
grant execute on function public.admin_asignar_vendedor(uuid, uuid, numeric)
  to authenticated, service_role;

-- ---- Guardar / borrar reglas.
create or replace function public.admin_guardar_regla_comision(
  p_id uuid default null,
  p_project_id uuid default null,
  p_profile_id uuid default null,
  p_nombre text default null,
  p_pct numeric default 0,
  p_base text default 'cobrado',
  p_activo boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare v_actor uuid; v_id uuid;
begin
  v_actor := private.assert_admin();
  if btrim(coalesce(p_nombre, '')) = '' then raise exception 'NOMBRE_REQUERIDO'; end if;
  if p_pct is null or p_pct < 0 or p_pct > 100 then raise exception 'PCT_INVALIDO'; end if;
  if p_base not in ('precio','cobrado') then raise exception 'BASE_INVALIDA'; end if;

  if p_id is null then
    insert into public.commission_rules (project_id, profile_id, nombre, pct, base, is_active)
    values (p_project_id, p_profile_id, btrim(p_nombre), p_pct, p_base, coalesce(p_activo, true))
    returning id into v_id;
  else
    update public.commission_rules
       set project_id = p_project_id, profile_id = p_profile_id, nombre = btrim(p_nombre),
           pct = p_pct, base = p_base, is_active = coalesce(p_activo, true), updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'REGLA_NO_ENCONTRADA'; end if;
  end if;

  perform private.audit('team', v_actor, null, 'comision.regla_guardada', p_project_id,
    'commission_rule', v_id, null,
    jsonb_build_object('nombre', p_nombre, 'pct', p_pct, 'base', p_base,
                       'perfil', p_profile_id));
  return jsonb_build_object('id', v_id);
end;
$fn$;

create or replace function public.admin_borrar_regla_comision(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare v_actor uuid;
begin
  v_actor := private.assert_admin();
  delete from public.commission_rules where id = p_id;
  if not found then raise exception 'REGLA_NO_ENCONTRADA'; end if;
  perform private.audit('team', v_actor, null, 'comision.regla_borrada', null,
    'commission_rule', p_id, null, null);
  return jsonb_build_object('ok', true);
end;
$fn$;

revoke execute on function
  public.admin_guardar_regla_comision(uuid, uuid, uuid, text, numeric, text, boolean),
  public.admin_borrar_regla_comision(uuid) from public, anon;
grant execute on function
  public.admin_guardar_regla_comision(uuid, uuid, uuid, text, numeric, text, boolean),
  public.admin_borrar_regla_comision(uuid) to authenticated, service_role;
