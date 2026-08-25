-- Las condiciones de financiamiento por RANGO DE PRECIO.
--
-- Terrenalv no financia igual un lote de Bs 8.000 que uno de Bs 90.000: la
-- cuota inicial que exige, el interés que cobra y el plazo que acepta cambian
-- según la escala del lote. Hasta ahora eso vivía en la cabeza de quien
-- vendía; ahora vive acá, y la pantalla de venta lo aplica sola.
--
-- Un rango puede ser de toda la empresa (project_id null) o de una
-- urbanización. Gana el más específico: primero el del proyecto, y entre
-- varios, el de rango más angosto.

create table if not exists public.financing_tiers (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid references public.projects (id) on delete cascade,
  nombre               text not null check (btrim(nombre) <> ''),
  price_from           numeric(14,2) not null default 0 check (price_from >= 0),
  price_to             numeric(14,2),
  -- Cuota inicial: porcentaje del precio (lo habitual) y/o un piso en Bs.
  down_payment_pct     numeric(5,2) not null default 0
                         check (down_payment_pct >= 0 and down_payment_pct <= 100),
  down_payment_min     numeric(14,2) not null default 0 check (down_payment_min >= 0),
  -- Interés MENSUAL sobre saldo (1.5 = 1,5% al mes). 0 = sin interés.
  monthly_interest_pct numeric(6,3) not null default 0
                         check (monthly_interest_pct >= 0 and monthly_interest_pct <= 20),
  max_months           int not null default 60 check (max_months between 1 and 480),
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint rango_coherente check (price_to is null or price_to >= price_from)
);

create index if not exists financing_tiers_lookup
  on public.financing_tiers (project_id, price_from);

alter table public.financing_tiers enable row level security;
revoke all on public.financing_tiers from anon, authenticated;
grant select on public.financing_tiers to authenticated;
create policy tiers_equipo_lee on public.financing_tiers
  for select to authenticated using (private.is_team());

drop trigger if exists set_updated_at on public.financing_tiers;
create trigger set_updated_at before update on public.financing_tiers
  for each row execute function private.tg_set_updated_at();

-- ---- Qué condiciones le tocan a un lote de tal precio.
create or replace function public.condiciones_financiamiento(
  p_project_id uuid, p_price numeric
)
returns jsonb
language sql
stable
security definer
set search_path = public, private, extensions, pg_temp
as $$
  select case when t.id is null then null else jsonb_build_object(
    'tier_id', t.id,
    'nombre', t.nombre,
    'desde', t.price_from,
    'hasta', t.price_to,
    'inicial_pct', t.down_payment_pct,
    'inicial_min', t.down_payment_min,
    -- La cuota inicial que corresponde a ESTE precio: el mayor entre el
    -- porcentaje y el piso, nunca más que el precio entero.
    'inicial_sugerida', least(coalesce(p_price, 0),
                              greatest(round(coalesce(p_price,0) * t.down_payment_pct / 100.0, 2),
                                       t.down_payment_min)),
    'interes_mensual_pct', t.monthly_interest_pct,
    'max_meses', t.max_months) end
    from (
      select t.*
        from public.financing_tiers t
       where t.is_active
         and (t.project_id = p_project_id or t.project_id is null)
         and coalesce(p_price, 0) >= t.price_from
         and (t.price_to is null or coalesce(p_price, 0) <= t.price_to)
       order by (t.project_id is not null) desc,
                coalesce(t.price_to, 999999999) - t.price_from,
                t.price_from desc
       limit 1
    ) t;
$$;

revoke execute on function public.condiciones_financiamiento(uuid, numeric) from public, anon;
grant execute on function public.condiciones_financiamiento(uuid, numeric)
  to authenticated, service_role;

-- ---- Alta, edición y baja, para la pantalla de configuración.
create or replace function public.admin_guardar_tier(
  p_id uuid default null,
  p_project_id uuid default null,
  p_nombre text default null,
  p_price_from numeric default 0,
  p_price_to numeric default null,
  p_down_pct numeric default 0,
  p_down_min numeric default 0,
  p_interes_mensual numeric default 0,
  p_max_meses int default 60,
  p_activo boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare v_actor uuid; v_id uuid; v_solapa int;
begin
  v_actor := private.assert_admin();
  if btrim(coalesce(p_nombre, '')) = '' then raise exception 'NOMBRE_REQUERIDO'; end if;
  if p_price_to is not null and p_price_to < p_price_from then raise exception 'RANGO_INVALIDO'; end if;
  if p_down_pct < 0 or p_down_pct > 100 then raise exception 'INICIAL_INVALIDA'; end if;
  if p_interes_mensual < 0 or p_interes_mensual > 20 then raise exception 'INTERES_INVALIDO'; end if;
  if p_max_meses < 1 or p_max_meses > 480 then raise exception 'PLAZO_INVALIDO'; end if;

  -- Dos rangos que se pisan en el mismo alcance dejan la condición al azar
  -- del orden de la consulta: se rechaza antes de guardarlo.
  select count(*) into v_solapa from public.financing_tiers t
   where t.is_active and p_activo
     and t.id is distinct from p_id
     and t.project_id is not distinct from p_project_id
     and p_price_from <= coalesce(t.price_to, 999999999)
     and coalesce(p_price_to, 999999999) >= t.price_from;
  if v_solapa > 0 then
    raise exception 'RANGO_SOLAPADO'
      using detail = 'Ya hay una clasificación activa que cubre parte de ese rango de precios.';
  end if;

  if p_id is null then
    insert into public.financing_tiers
      (project_id, nombre, price_from, price_to, down_payment_pct, down_payment_min,
       monthly_interest_pct, max_months, is_active)
    values
      (p_project_id, btrim(p_nombre), p_price_from, p_price_to, p_down_pct, p_down_min,
       p_interes_mensual, p_max_meses, coalesce(p_activo, true))
    returning id into v_id;
  else
    update public.financing_tiers
       set project_id = p_project_id, nombre = btrim(p_nombre),
           price_from = p_price_from, price_to = p_price_to,
           down_payment_pct = p_down_pct, down_payment_min = p_down_min,
           monthly_interest_pct = p_interes_mensual, max_months = p_max_meses,
           is_active = coalesce(p_activo, true), updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'TIER_NOT_FOUND'; end if;
  end if;

  perform private.audit('team', v_actor, null, 'financiamiento.guardado', p_project_id,
    'financing_tier', v_id, null,
    jsonb_build_object('nombre', p_nombre, 'desde', p_price_from, 'hasta', p_price_to,
                       'inicial_pct', p_down_pct, 'interes', p_interes_mensual,
                       'max_meses', p_max_meses));

  return jsonb_build_object('id', v_id);
end;
$fn$;

create or replace function public.admin_borrar_tier(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare v_actor uuid;
begin
  v_actor := private.assert_admin();
  delete from public.financing_tiers where id = p_id;
  if not found then raise exception 'TIER_NOT_FOUND'; end if;
  perform private.audit('team', v_actor, null, 'financiamiento.borrado', null,
    'financing_tier', p_id, null, null);
  return jsonb_build_object('ok', true);
end;
$fn$;

revoke execute on function
  public.admin_guardar_tier(uuid, uuid, text, numeric, numeric, numeric, numeric, numeric, int, boolean),
  public.admin_borrar_tier(uuid) from public, anon;
grant execute on function
  public.admin_guardar_tier(uuid, uuid, text, numeric, numeric, numeric, numeric, numeric, int, boolean),
  public.admin_borrar_tier(uuid) to authenticated, service_role;

-- ---- Punto de partida: tres escalas con 1,5% mensual, para que la oficina
--      ajuste sobre algo escrito en vez de sobre una tabla vacía.
insert into public.financing_tiers
  (project_id, nombre, price_from, price_to, down_payment_pct, down_payment_min,
   monthly_interest_pct, max_months)
select null, 'Lotes hasta Bs 10.000', 0, 10000, 10, 0, 1.5, 24
 where not exists (select 1 from public.financing_tiers);
insert into public.financing_tiers
  (project_id, nombre, price_from, price_to, down_payment_pct, down_payment_min,
   monthly_interest_pct, max_months)
select null, 'Lotes de Bs 10.001 a 50.000', 10000.01, 50000, 15, 0, 1.5, 48
 where not exists (select 1 from public.financing_tiers where price_from = 10000.01);
insert into public.financing_tiers
  (project_id, nombre, price_from, price_to, down_payment_pct, down_payment_min,
   monthly_interest_pct, max_months)
select null, 'Lotes de más de Bs 50.000', 50000.01, null, 20, 0, 1.5, 60
 where not exists (select 1 from public.financing_tiers where price_from = 50000.01);
