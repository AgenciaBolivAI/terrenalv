-- RECURSOS HUMANOS — el personal, sus contratos y la planilla mensual.
--
-- La idea viene del módulo de RRHH de totalpec, achicada a lo que esta
-- empresa necesita hoy: quién trabaja acá, qué gana, y la planilla del mes
-- que baja a contabilidad como egreso de sueldos SIN cargarla a mano.
--
-- Un empleado NO es un usuario del panel: la cuadrilla de obra no tiene
-- login. Si además usa el panel (un vendedor), se enlaza a su profile.
--
-- LO QUE NO HACE TODAVÍA, dicho: asistencia, vacaciones, finiquitos y los
-- cálculos finos de ley (RC-IVA, AFP por tramos). La planilla carga sueldo,
-- bonos y descuentos como montos que el contador escribe; la retención
-- automática viene después si hace falta.

create table if not exists public.hr_empleados (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  nombre_completo text not null,
  ci text,
  fecha_nacimiento date,
  telefono text,
  correo text,
  direccion text,
  cargo text not null,
  area text,
  -- Dónde trabaja: null = toda la empresa.
  project_id uuid references public.projects(id),
  centro_costo_id uuid references public.centros_costo(id),
  profile_id uuid references public.profiles(id),
  fecha_ingreso date not null,
  fecha_retiro date,
  salario_mensual numeric(12,2) not null default 0,
  estado text not null default 'activo',
  nota text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_empleados_estado_check check (estado in ('activo','retirado')),
  constraint hr_empleados_salario_check check (salario_mensual >= 0),
  constraint hr_empleados_codigo_check check (btrim(codigo) <> ''),
  constraint hr_empleados_nombre_check check (btrim(nombre_completo) <> ''),
  constraint hr_empleados_cargo_check check (btrim(cargo) <> ''),
  constraint hr_empleados_retiro_check
    check (estado = 'activo' or fecha_retiro is not null)
);

create unique index if not exists hr_empleados_codigo_uidx
  on public.hr_empleados (lower(btrim(codigo)));
create index if not exists hr_empleados_estado_idx on public.hr_empleados(estado);

create table if not exists public.hr_planillas (
  id uuid primary key default gen_random_uuid(),
  anio int not null,
  mes int not null,
  estado text not null default 'borrador',
  pagada_de uuid references public.treasury_accounts(id),
  nota text,
  created_by uuid references public.profiles(id),
  pagada_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_planillas_mes_check check (mes between 1 and 12),
  constraint hr_planillas_estado_check check (estado in ('borrador','pagada')),
  constraint hr_planillas_unica unique (anio, mes)
);

create table if not exists public.hr_planilla_items (
  id uuid primary key default gen_random_uuid(),
  planilla_id uuid not null references public.hr_planillas(id) on delete cascade,
  empleado_id uuid not null references public.hr_empleados(id),
  salario numeric(12,2) not null default 0,
  bonos numeric(12,2) not null default 0,
  descuentos numeric(12,2) not null default 0,
  neto numeric(12,2) generated always as (salario + bonos - descuentos) stored,
  nota text,
  -- El egreso contable que generó el pago, cuando la planilla se paga.
  expense_id uuid references public.expenses(id),
  constraint hr_items_montos_check
    check (salario >= 0 and bonos >= 0 and descuentos >= 0),
  constraint hr_items_unico unique (planilla_id, empleado_id)
);

alter table public.hr_empleados      enable row level security;
alter table public.hr_planillas      enable row level security;
alter table public.hr_planilla_items enable row level security;

drop policy if exists hr_empleados_lee on public.hr_empleados;
create policy hr_empleados_lee on public.hr_empleados
  for select to authenticated using (private.is_team());
drop policy if exists hr_planillas_lee on public.hr_planillas;
create policy hr_planillas_lee on public.hr_planillas
  for select to authenticated using (private.is_team());
drop policy if exists hr_planilla_items_lee on public.hr_planilla_items;
create policy hr_planilla_items_lee on public.hr_planilla_items
  for select to authenticated using (private.is_team());

drop trigger if exists solo_lectura on public.hr_empleados;
create trigger solo_lectura before insert or update or delete on public.hr_empleados
  for each row execute function private.tg_solo_lectura('rrhh');
drop trigger if exists solo_lectura on public.hr_planillas;
create trigger solo_lectura before insert or update or delete on public.hr_planillas
  for each row execute function private.tg_solo_lectura('rrhh');
drop trigger if exists solo_lectura on public.hr_planilla_items;
create trigger solo_lectura before insert or update or delete on public.hr_planilla_items
  for each row execute function private.tg_solo_lectura('rrhh');

-- ---------- RPCs ------------------------------------------------------------
create or replace function public.admin_guardar_empleado(
  p_id uuid default null,
  p_codigo text default null,
  p_nombre text default null,
  p_ci text default null,
  p_telefono text default null,
  p_correo text default null,
  p_cargo text default null,
  p_area text default null,
  p_project_id uuid default null,
  p_centro_costo_id uuid default null,
  p_profile_id uuid default null,
  p_fecha_ingreso date default null,
  p_salario numeric default 0,
  p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid; v_id uuid;
begin
  v_actor := private.assert_accounting();
  if btrim(coalesce(p_codigo,'')) = '' then raise exception 'CODIGO_REQUERIDO'; end if;
  if btrim(coalesce(p_nombre,'')) = '' then raise exception 'NOMBRE_REQUERIDO'; end if;
  if btrim(coalesce(p_cargo,'')) = '' then raise exception 'CARGO_REQUERIDO'; end if;
  if p_fecha_ingreso is null then raise exception 'FECHA_REQUERIDA'; end if;
  if coalesce(p_salario,0) < 0 then raise exception 'SALARIO_INVALIDO'; end if;

  if p_id is null then
    insert into public.hr_empleados
      (codigo, nombre_completo, ci, telefono, correo, cargo, area, project_id,
       centro_costo_id, profile_id, fecha_ingreso, salario_mensual, nota, created_by)
    values (btrim(p_codigo), btrim(p_nombre), nullif(btrim(coalesce(p_ci,'')),''),
       nullif(btrim(coalesce(p_telefono,'')),''), nullif(btrim(coalesce(p_correo,'')),''),
       btrim(p_cargo), nullif(btrim(coalesce(p_area,'')),''), p_project_id,
       p_centro_costo_id, p_profile_id, p_fecha_ingreso, coalesce(p_salario,0),
       nullif(btrim(coalesce(p_nota,'')),''), v_actor)
    returning id into v_id;
  else
    update public.hr_empleados
       set codigo = btrim(p_codigo), nombre_completo = btrim(p_nombre),
           ci = nullif(btrim(coalesce(p_ci,'')),''),
           telefono = nullif(btrim(coalesce(p_telefono,'')),''),
           correo = nullif(btrim(coalesce(p_correo,'')),''),
           cargo = btrim(p_cargo), area = nullif(btrim(coalesce(p_area,'')),''),
           project_id = p_project_id, centro_costo_id = p_centro_costo_id,
           profile_id = p_profile_id, fecha_ingreso = p_fecha_ingreso,
           salario_mensual = coalesce(p_salario,0),
           nota = nullif(btrim(coalesce(p_nota,'')),''), updated_at = now()
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'EMPLEADO_NO_ENCONTRADO'; end if;
  end if;

  perform private.audit('team', v_actor, null, 'rrhh.empleado', p_project_id,
    'hr_empleado', v_id, null,
    jsonb_build_object('codigo', p_codigo, 'cargo', p_cargo, 'salario', p_salario));
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.admin_retirar_empleado(p_id uuid, p_fecha date, p_nota text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid; v_e public.hr_empleados%rowtype;
begin
  v_actor := private.assert_accounting();
  if btrim(coalesce(p_nota,'')) = '' then raise exception 'NOTE_REQUIRED'; end if;
  select * into v_e from public.hr_empleados where id = p_id for update;
  if not found then raise exception 'EMPLEADO_NO_ENCONTRADO'; end if;
  if v_e.estado <> 'activo' then raise exception 'YA_RETIRADO'; end if;
  if coalesce(p_fecha, current_date) < v_e.fecha_ingreso then
    raise exception 'FECHA_INVALIDA';
  end if;
  update public.hr_empleados
     set estado = 'retirado', fecha_retiro = coalesce(p_fecha, current_date),
         nota = coalesce(nota || ' · ', '') || btrim(p_nota), updated_at = now()
   where id = p_id;
  perform private.audit('team', v_actor, null, 'rrhh.retiro', v_e.project_id,
    'hr_empleado', p_id, null, jsonb_build_object('fecha', p_fecha, 'nota', btrim(p_nota)));
  return jsonb_build_object('ok', true);
end;
$$;

-- Armar la planilla del mes: un renglón por empleado activo, con su salario.
create or replace function public.admin_armar_planilla(p_anio int, p_mes int)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid; v_id uuid; v_n int;
begin
  v_actor := private.assert_accounting();
  if p_mes < 1 or p_mes > 12 then raise exception 'MES_INVALIDO'; end if;

  select id into v_id from public.hr_planillas where anio = p_anio and mes = p_mes;
  if v_id is not null then
    raise exception 'PLANILLA_YA_EXISTE'
      using detail = 'La planilla de ese mes ya está armada. Editala o pagala.';
  end if;

  insert into public.hr_planillas (anio, mes, created_by)
  values (p_anio, p_mes, v_actor) returning id into v_id;

  insert into public.hr_planilla_items (planilla_id, empleado_id, salario)
  select v_id, e.id, e.salario_mensual
    from public.hr_empleados e
   where e.estado = 'activo'
     and e.fecha_ingreso <= (make_date(p_anio, p_mes, 1) + interval '1 month - 1 day')::date;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    delete from public.hr_planillas where id = v_id;
    raise exception 'SIN_EMPLEADOS'
      using detail = 'No hay empleados activos para ese mes.';
  end if;

  perform private.audit('team', v_actor, null, 'rrhh.planilla', null,
    'hr_planilla', v_id, null,
    jsonb_build_object('anio', p_anio, 'mes', p_mes, 'empleados', v_n));
  return jsonb_build_object('id', v_id, 'empleados', v_n);
end;
$$;

create or replace function public.admin_editar_item_planilla(
  p_item_id uuid, p_salario numeric, p_bonos numeric, p_descuentos numeric, p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid; v_estado text;
begin
  v_actor := private.assert_accounting();
  select pl.estado into v_estado
    from public.hr_planilla_items i join public.hr_planillas pl on pl.id = i.planilla_id
   where i.id = p_item_id;
  if v_estado is null then raise exception 'ITEM_NO_ENCONTRADO'; end if;
  if v_estado <> 'borrador' then
    raise exception 'PLANILLA_PAGADA'
      using detail = 'Una planilla pagada no se toca: la plata ya salió.';
  end if;
  if coalesce(p_salario,0) < 0 or coalesce(p_bonos,0) < 0 or coalesce(p_descuentos,0) < 0 then
    raise exception 'MONTO_INVALIDO';
  end if;
  update public.hr_planilla_items
     set salario = coalesce(p_salario, salario), bonos = coalesce(p_bonos, bonos),
         descuentos = coalesce(p_descuentos, descuentos),
         nota = nullif(btrim(coalesce(p_nota,'')),'')
   where id = p_item_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Pagar la planilla: UN egreso de sueldos por empleado, con su centro de
-- costos, desde la caja elegida. La contabilidad sale sola.
create or replace function public.admin_pagar_planilla(
  p_planilla_id uuid, p_treasury_account_id uuid, p_fecha date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_actor uuid;
  v_pl public.hr_planillas%rowtype;
  r record;
  v_res jsonb;
  v_total numeric(14,2) := 0;
  v_n int := 0;
  v_proj uuid;
  v_concepto uuid;
begin
  v_actor := private.assert_accounting();
  select * into v_pl from public.hr_planillas where id = p_planilla_id for update;
  if not found then raise exception 'PLANILLA_NO_ENCONTRADA'; end if;
  if v_pl.estado <> 'borrador' then raise exception 'YA_PAGADA'; end if;
  if not exists (select 1 from public.treasury_accounts
                  where id = p_treasury_account_id and is_active) then
    raise exception 'TREASURY_NOT_FOUND';
  end if;

  select id into v_concepto from public.expense_concepts where codigo = 'PER-SUE';

  for r in
    select i.id as item_id, i.neto, i.nota, e.nombre_completo, e.codigo,
           e.project_id, e.centro_costo_id
      from public.hr_planilla_items i
      join public.hr_empleados e on e.id = i.empleado_id
     where i.planilla_id = p_planilla_id and i.neto > 0
  loop
    -- El egreso necesita una urbanización; el empleado de toda la empresa
    -- carga a la primera activa (y a su centro de costos si tiene).
    v_proj := coalesce(r.project_id,
      (select id from public.projects where status = 'activo' order by name limit 1));

    v_res := public.admin_record_expense(
      v_proj, coalesce(p_fecha, current_date), 'sueldos'::expense_category,
      format('Sueldo %s/%s — %s', lpad(v_pl.mes::text,2,'0'), v_pl.anio, r.nombre_completo),
      r.neto, 'BOB', r.nombre_completo, null, r.nota,
      p_treasury_account_id, null, r.centro_costo_id, 'empresa', null, null, v_concepto);

    update public.hr_planilla_items
       set expense_id = (v_res->>'expense_id')::uuid where id = r.item_id;
    v_total := v_total + r.neto;
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then raise exception 'PLANILLA_VACIA'; end if;

  update public.hr_planillas
     set estado = 'pagada', pagada_de = p_treasury_account_id,
         pagada_at = now(), updated_at = now()
   where id = p_planilla_id;

  perform private.audit('team', v_actor, null, 'rrhh.planilla_pagada', null,
    'hr_planilla', p_planilla_id, null,
    jsonb_build_object('anio', v_pl.anio, 'mes', v_pl.mes,
                       'empleados', v_n, 'total', v_total));
  return jsonb_build_object('ok', true, 'empleados', v_n, 'total', v_total);
end;
$$;

do $$
declare f text;
begin
  for f in select unnest(array[
    'admin_guardar_empleado(uuid, text, text, text, text, text, text, text, uuid, uuid, uuid, date, numeric, text)',
    'admin_retirar_empleado(uuid, date, text)',
    'admin_armar_planilla(int, int)',
    'admin_editar_item_planilla(uuid, numeric, numeric, numeric, text)',
    'admin_pagar_planilla(uuid, uuid, date)'])
  loop
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('revoke execute on function public.%s from anon', f);
  end loop;
end $$;

-- La sección rrhh en los permisos.
do $$
declare v_def text; fn text;
begin
  for fn in select unnest(array['nivel_de','mi_acceso','admin_guardar_permisos']) loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where p.proname = fn and n.nspname in ('public','private');
    if position('''inventario'',''activos''' in v_def) = 0 then
      raise exception 'PARCHE_%_NO_AGARRA', fn;
    end if;
    v_def := replace(v_def, '''inventario'',''activos''',
                            '''inventario'',''activos'',''rrhh''');
    execute v_def;
  end loop;
end $$;
