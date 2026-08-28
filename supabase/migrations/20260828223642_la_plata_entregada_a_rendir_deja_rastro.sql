-- FONDOS POR RENDIR.
--
-- La contadora los nombró entre los gastos de administración: se le entrega
-- plata a alguien para que compre, y esa persona después rinde con facturas.
-- Mientras no rinde, la plata NO es un gasto: es algo que esa persona le debe
-- a la empresa — la cuenta 1.02.04.030 FONDOS A RENDIR, que el plan ya trae y
-- que hasta hoy no usaba nadie.
--
-- El ciclo:
--   entrega   → sale de la caja, entra a 1.02.04.030 a nombre de la persona
--   rendición → un egreso con forma_pago='fondos_por_rendir' que descarga
--               1.02.04.030 contra la cuenta de gasto que corresponda
--   devolución→ la persona devuelve lo que no gastó
--   saldo     → entregado − devuelto − rendido, por persona
--
-- La entrega y la devolución son documentos por derecho propio, así que
-- viven en su tabla —como el egreso vive en `expenses`— y el diario los
-- deriva. No se asientan como comprobante manual: si lo fueran, se contarían
-- dos veces cuando el diario los lea.

create table if not exists public.fondos_a_rendir (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  empleado_id uuid not null references public.hr_empleados (id),
  tipo text not null check (tipo in ('entrega','devolucion')),
  fecha date not null,
  numero text,
  monto numeric(14,2) not null check (monto > 0),
  treasury_account_id uuid references public.treasury_accounts (id),
  glosa text not null check (btrim(glosa) <> ''),
  nota text,
  anulado_nota text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.fondos_a_rendir is
  'Entregas y devoluciones de plata a rendir. El gasto en sí se registra como '
  'egreso con forma_pago = fondos_por_rendir; acá está solo el movimiento del '
  'fondo.';

create index if not exists fondos_a_rendir_empleado_idx
  on public.fondos_a_rendir (empleado_id) where deleted_at is null;
create index if not exists fondos_a_rendir_fecha_idx
  on public.fondos_a_rendir (fecha) where deleted_at is null;

-- El correlativo es del LIBRO, igual que C/E y los comprobantes: con lock,
-- porque dos personas entregando a la vez no es raro.
create or replace function private.next_fondo_number()
returns text
language plpgsql
set search_path to 'public', 'private'
as $$
declare v_n int;
begin
  perform pg_advisory_xact_lock(hashtext('comprobante:fondo'));
  select coalesce(max(substring(numero from '[0-9]+$')::int), 0) + 1
    into v_n from public.fondos_a_rendir;
  return 'FDO-' || lpad(v_n::text, 4, '0');
end;
$$;

create or replace function private.tg_fondo_numero()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
begin
  if new.numero is null then new.numero := private.next_fondo_number(); end if;
  return new;
end;
$$;

drop trigger if exists fondos_numero on public.fondos_a_rendir;
create trigger fondos_numero before insert on public.fondos_a_rendir
  for each row execute function private.tg_fondo_numero();

create unique index if not exists fondos_a_rendir_numero_uidx
  on public.fondos_a_rendir (numero) where numero is not null;

drop trigger if exists fondos_solo_lectura on public.fondos_a_rendir;
create trigger fondos_solo_lectura
  before insert or update or delete on public.fondos_a_rendir
  for each row execute function private.tg_solo_lectura('contabilidad');

alter table public.fondos_a_rendir enable row level security;
drop policy if exists fondos_read on public.fondos_a_rendir;
create policy fondos_read on public.fondos_a_rendir
  for select to authenticated using (private.is_team());

revoke insert, update, delete on public.fondos_a_rendir from authenticated, anon;
grant select on public.fondos_a_rendir to authenticated;

-- ---------------------------------------------------------------------------
-- El saldo por persona. Sale de las tablas base (no del libro) para que el
-- guardián pueda comparar una cosa contra la otra.
-- ---------------------------------------------------------------------------
create or replace view public.v_fondos_por_rendir as
select e.id as empleado_id,
       e.codigo,
       e.nombre_completo,
       e.estado,
       coalesce(f.entregado, 0) as entregado,
       coalesce(f.devuelto, 0) as devuelto,
       coalesce(r.rendido, 0) as rendido,
       round(coalesce(f.entregado,0) - coalesce(f.devuelto,0) - coalesce(r.rendido,0), 2) as saldo,
       f.ultima_entrega
  from public.hr_empleados e
  left join (
    select empleado_id,
           sum(monto) filter (where tipo = 'entrega') as entregado,
           sum(monto) filter (where tipo = 'devolucion') as devuelto,
           max(fecha) filter (where tipo = 'entrega') as ultima_entrega
      from public.fondos_a_rendir where deleted_at is null
     group by empleado_id) f on f.empleado_id = e.id
  left join (
    select fondo_empleado_id, sum(amount_bob) as rendido
      from public.expenses
     where deleted_at is null and forma_pago = 'fondos_por_rendir'
     group by fondo_empleado_id) r on r.fondo_empleado_id = e.id
 where (f.empleado_id is not null or r.fondo_empleado_id is not null)
   and private.ve_contabilidad();

alter view public.v_fondos_por_rendir set (security_invoker = true);
grant select on public.v_fondos_por_rendir to authenticated;
revoke all on public.v_fondos_por_rendir from anon;

-- ---------------------------------------------------------------------------
-- Entregar, devolver, anular.
-- ---------------------------------------------------------------------------
create or replace function public.admin_entregar_fondo(
  p_empleado_id uuid,
  p_monto numeric,
  p_treasury_account_id uuid,
  p_fecha date default current_date,
  p_glosa text default null,
  p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid; v_emp public.hr_empleados%rowtype; v_proj uuid; v_id uuid; v_num text;
begin
  v_actor := private.assert_contabilidad();
  if coalesce(p_monto, 0) <= 0 then raise exception 'IMPORTE_CERO'; end if;

  select * into v_emp from public.hr_empleados where id = p_empleado_id;
  if v_emp.id is null then raise exception 'EMPLEADO_NO_ENCONTRADO'; end if;
  if v_emp.estado <> 'activo' then
    raise exception 'EMPLEADO_RETIRADO'
      using detail = 'No se le entrega un fondo a alguien que ya no trabaja acá.';
  end if;
  if p_treasury_account_id is not null
     and not exists (select 1 from public.treasury_accounts t
                      where t.id = p_treasury_account_id and t.is_active) then
    raise exception 'CUENTA_NO_ENCONTRADA';
  end if;

  -- El fondo es plata de la empresa, no de una urbanización.
  v_proj := private.proyecto_administracion();
  perform private.assert_periodo_abierto(v_proj, coalesce(p_fecha, current_date));

  insert into public.fondos_a_rendir
    (project_id, empleado_id, tipo, fecha, monto, treasury_account_id, glosa, nota, created_by)
  values (v_proj, p_empleado_id, 'entrega', coalesce(p_fecha, current_date),
          round(p_monto, 2), p_treasury_account_id,
          coalesce(nullif(btrim(coalesce(p_glosa, '')), ''),
                   'Entrega de fondo a rendir — ' || v_emp.nombre_completo),
          nullif(btrim(coalesce(p_nota, '')), ''), v_actor)
  returning id, numero into v_id, v_num;

  perform private.audit('team', v_actor, null, 'fondo.entregado', null, 'fondo', v_id, null,
    jsonb_build_object('empleado', v_emp.nombre_completo, 'monto', round(p_monto,2), 'numero', v_num));
  return jsonb_build_object('id', v_id, 'numero', v_num);
end;
$$;

create or replace function public.admin_devolver_fondo(
  p_empleado_id uuid,
  p_monto numeric,
  p_treasury_account_id uuid,
  p_fecha date default current_date,
  p_glosa text default null,
  p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid; v_emp public.hr_empleados%rowtype; v_proj uuid; v_saldo numeric; v_id uuid; v_num text;
begin
  v_actor := private.assert_contabilidad();
  if coalesce(p_monto, 0) <= 0 then raise exception 'IMPORTE_CERO'; end if;

  select * into v_emp from public.hr_empleados where id = p_empleado_id;
  if v_emp.id is null then raise exception 'EMPLEADO_NO_ENCONTRADO'; end if;

  select coalesce(sum(case tipo when 'entrega' then monto else -monto end), 0)
    into v_saldo from public.fondos_a_rendir
   where empleado_id = p_empleado_id and deleted_at is null;
  v_saldo := v_saldo - coalesce((select sum(amount_bob) from public.expenses
                                  where deleted_at is null
                                    and forma_pago = 'fondos_por_rendir'
                                    and fondo_empleado_id = p_empleado_id), 0);
  if round(p_monto, 2) > round(v_saldo, 2) then
    raise exception 'SALDO_INSUFICIENTE'
      using detail = format('El fondo de %s tiene Bs %s.', v_emp.nombre_completo, round(v_saldo, 2));
  end if;

  v_proj := private.proyecto_administracion();
  perform private.assert_periodo_abierto(v_proj, coalesce(p_fecha, current_date));

  insert into public.fondos_a_rendir
    (project_id, empleado_id, tipo, fecha, monto, treasury_account_id, glosa, nota, created_by)
  values (v_proj, p_empleado_id, 'devolucion', coalesce(p_fecha, current_date),
          round(p_monto, 2), p_treasury_account_id,
          coalesce(nullif(btrim(coalesce(p_glosa, '')), ''),
                   'Devolución de fondo a rendir — ' || v_emp.nombre_completo),
          nullif(btrim(coalesce(p_nota, '')), ''), v_actor)
  returning id, numero into v_id, v_num;

  perform private.audit('team', v_actor, null, 'fondo.devuelto', null, 'fondo', v_id, null,
    jsonb_build_object('empleado', v_emp.nombre_completo, 'monto', round(p_monto,2), 'numero', v_num));
  return jsonb_build_object('id', v_id, 'numero', v_num);
end;
$$;

create or replace function public.admin_anular_fondo(p_id uuid, p_nota text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid; v_f public.fondos_a_rendir%rowtype; v_saldo numeric;
begin
  v_actor := private.assert_contabilidad();
  if btrim(coalesce(p_nota, '')) = '' then raise exception 'NOTE_REQUIRED'; end if;

  select * into v_f from public.fondos_a_rendir where id = p_id;
  if v_f.id is null then raise exception 'FONDO_NO_ENCONTRADO'; end if;
  if v_f.deleted_at is not null then raise exception 'FONDO_YA_ANULADO'; end if;
  perform private.assert_periodo_abierto(v_f.project_id, v_f.fecha);

  -- Sacar una entrega no puede dejar a la persona rindiendo más de lo que tiene.
  if v_f.tipo = 'entrega' then
    select coalesce(sum(case tipo when 'entrega' then monto else -monto end), 0)
      into v_saldo from public.fondos_a_rendir
     where empleado_id = v_f.empleado_id and deleted_at is null and id <> p_id;
    v_saldo := v_saldo - coalesce((select sum(amount_bob) from public.expenses
                                    where deleted_at is null
                                      and forma_pago = 'fondos_por_rendir'
                                      and fondo_empleado_id = v_f.empleado_id), 0);
    if round(v_saldo, 2) < 0 then
      raise exception 'FONDO_YA_RENDIDO'
        using detail = 'Esa entrega ya se gastó: anular la rendición primero.';
    end if;
  end if;

  update public.fondos_a_rendir
     set deleted_at = now(), anulado_nota = btrim(p_nota), updated_at = now()
   where id = p_id;

  perform private.audit('team', v_actor, null, 'fondo.anulado', null, 'fondo', p_id, null,
    jsonb_build_object('numero', v_f.numero, 'nota', btrim(p_nota)));
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.admin_entregar_fondo(uuid, numeric, uuid, date, text, text) to authenticated;
grant execute on function public.admin_devolver_fondo(uuid, numeric, uuid, date, text, text) to authenticated;
grant execute on function public.admin_anular_fondo(uuid, text) to authenticated;
revoke execute on function public.admin_entregar_fondo(uuid, numeric, uuid, date, text, text) from anon;
revoke execute on function public.admin_devolver_fondo(uuid, numeric, uuid, date, text, text) from anon;
revoke execute on function public.admin_anular_fondo(uuid, text) from anon;
