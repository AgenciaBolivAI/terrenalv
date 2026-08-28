-- EL FILE DE CADA DEPENDIENTE.
--
-- La contadora mandó la planilla de «DATOS PERSONALES» que usan en papel y
-- pidió que el módulo de RRHH sea «tipo kardex… esa información es muy útil
-- para el file de cada dependiente». La ficha que teníamos guardaba nombre,
-- CI, teléfono, cargo, área, ingreso y sueldo: alcanza para pagar una
-- planilla, no para tener un file.
--
-- Van los campos de su hoja, uno por uno. La EDAD no se guarda: se calcula de
-- la fecha de nacimiento, porque un número que envejece solo en la base es un
-- número que en un año miente.
alter table public.hr_empleados
  add column if not exists nacionalidad text,
  add column if not exists estado_civil text,
  add column if not exists profesion text,
  add column if not exists estudios_primaria text,
  add column if not exists estudios_secundaria text,
  add column if not exists estudios_tecnicos text,
  add column if not exists estudios_universitarios text,
  add column if not exists experiencia_laboral text,
  add column if not exists referencias text,
  add column if not exists contacto_emergencia_nombre text,
  add column if not exists contacto_emergencia_telefono text,
  add column if not exists contacto_emergencia_parentesco text,
  add column if not exists afp text,
  add column if not exists nua text,
  add column if not exists caja_salud text,
  add column if not exists banco text,
  add column if not exists cuenta_bancaria text,
  add column if not exists tipo_contrato text,
  add column if not exists fecha_fin_contrato date;

comment on column public.hr_empleados.experiencia_laboral is
  'Dónde trabajó antes, en texto libre: es lo que la planilla de papel pide '
  'como «EXPERIENCIA LABORAL».';
comment on column public.hr_empleados.referencias is
  'Referencias laborales y personales, en texto libre.';
comment on column public.hr_empleados.nua is
  'NUA/CUA: el número con el que la AFP identifica al dependiente.';

alter table public.hr_empleados drop constraint if exists hr_empleados_estado_civil_check;
alter table public.hr_empleados add constraint hr_empleados_estado_civil_check
  check (estado_civil is null or estado_civil in
         ('soltero','casado','divorciado','viudo','concubinato'));

alter table public.hr_empleados drop constraint if exists hr_empleados_tipo_contrato_check;
alter table public.hr_empleados add constraint hr_empleados_tipo_contrato_check
  check (tipo_contrato is null or tipo_contrato in
         ('indefinido','plazo_fijo','obra','consultoria'));

-- Un contrato a plazo sin fecha de fin es un contrato indefinido mal escrito.
alter table public.hr_empleados drop constraint if exists hr_empleados_fin_contrato_check;
alter table public.hr_empleados add constraint hr_empleados_fin_contrato_check
  check (tipo_contrato is distinct from 'indefinido' or fecha_fin_contrato is null);

-- ---------------------------------------------------------------------------
-- Los papeles del file: carnet, contrato, currículum, el croquis del domicilio.
-- ---------------------------------------------------------------------------
create table if not exists public.hr_documentos (
  id uuid primary key default gen_random_uuid(),
  empleado_id uuid not null references public.hr_empleados (id) on delete cascade,
  tipo text not null check (tipo in
    ('ci','contrato','curriculum','titulo','afp','caja_salud','memorandum','croquis','otro')),
  nombre text not null check (btrim(nombre) <> ''),
  storage_path text not null,
  subido_por uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.hr_documentos is
  'Los papeles escaneados del file de cada dependiente. El archivo vive en el '
  'bucket privado hr-docs; acá está solo la ficha.';

create index if not exists hr_documentos_empleado_idx
  on public.hr_documentos (empleado_id) where deleted_at is null;

alter table public.hr_documentos enable row level security;
drop policy if exists hr_documentos_read on public.hr_documentos;
create policy hr_documentos_read on public.hr_documentos
  for select to authenticated using (private.is_team());

drop trigger if exists hr_documentos_solo_lectura on public.hr_documentos;
create trigger hr_documentos_solo_lectura
  before insert or update or delete on public.hr_documentos
  for each row execute function private.tg_solo_lectura('rrhh');

revoke insert, update, delete on public.hr_documentos from authenticated, anon;
grant select on public.hr_documentos to authenticated;

-- El bucket es privado: los papeles del personal se leen con URL firmada,
-- igual que los comprobantes de pago.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hr-docs', 'hr-docs', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- La ficha, con todo lo del file.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_guardar_empleado(uuid, text, text, text, text, text, text, text, uuid, uuid, uuid, date, numeric, text);

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
  p_nota text default null,
  p_fecha_nacimiento date default null,
  p_direccion text default null,
  p_nacionalidad text default null,
  p_estado_civil text default null,
  p_profesion text default null,
  p_estudios_primaria text default null,
  p_estudios_secundaria text default null,
  p_estudios_tecnicos text default null,
  p_estudios_universitarios text default null,
  p_experiencia_laboral text default null,
  p_referencias text default null,
  p_emergencia_nombre text default null,
  p_emergencia_telefono text default null,
  p_emergencia_parentesco text default null,
  p_afp text default null,
  p_nua text default null,
  p_caja_salud text default null,
  p_banco text default null,
  p_cuenta_bancaria text default null,
  p_tipo_contrato text default null,
  p_fecha_fin_contrato date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid; v_id uuid; v_contrato text;
begin
  v_actor := private.assert_accounting();
  if btrim(coalesce(p_codigo,'')) = '' then raise exception 'CODIGO_REQUERIDO'; end if;
  if btrim(coalesce(p_nombre,'')) = '' then raise exception 'NOMBRE_REQUERIDO'; end if;
  if btrim(coalesce(p_cargo,'')) = '' then raise exception 'CARGO_REQUERIDO'; end if;
  if p_fecha_ingreso is null then raise exception 'FECHA_REQUERIDA'; end if;
  if coalesce(p_salario,0) < 0 then raise exception 'SALARIO_INVALIDO'; end if;

  v_contrato := nullif(btrim(coalesce(p_tipo_contrato,'')),'');
  if v_contrato = 'indefinido' and p_fecha_fin_contrato is not null then
    raise exception 'CONTRATO_INDEFINIDO_CON_FIN'
      using detail = 'Un contrato indefinido no lleva fecha de fin.';
  end if;
  if v_contrato is not null and v_contrato <> 'indefinido' and p_fecha_fin_contrato is null then
    raise exception 'CONTRATO_SIN_FIN'
      using detail = 'Un contrato a plazo necesita su fecha de fin.';
  end if;

  if p_id is null then
    insert into public.hr_empleados
      (codigo, nombre_completo, ci, telefono, correo, cargo, area, project_id,
       centro_costo_id, profile_id, fecha_ingreso, salario_mensual, nota, created_by,
       fecha_nacimiento, direccion, nacionalidad, estado_civil, profesion,
       estudios_primaria, estudios_secundaria, estudios_tecnicos, estudios_universitarios,
       experiencia_laboral, referencias, contacto_emergencia_nombre,
       contacto_emergencia_telefono, contacto_emergencia_parentesco,
       afp, nua, caja_salud, banco, cuenta_bancaria, tipo_contrato, fecha_fin_contrato)
    values (btrim(p_codigo), btrim(p_nombre), nullif(btrim(coalesce(p_ci,'')),''),
       nullif(btrim(coalesce(p_telefono,'')),''), nullif(btrim(coalesce(p_correo,'')),''),
       btrim(p_cargo), nullif(btrim(coalesce(p_area,'')),''), p_project_id,
       p_centro_costo_id, p_profile_id, p_fecha_ingreso, coalesce(p_salario,0),
       nullif(btrim(coalesce(p_nota,'')),''), v_actor,
       p_fecha_nacimiento, nullif(btrim(coalesce(p_direccion,'')),''),
       nullif(btrim(coalesce(p_nacionalidad,'')),''), nullif(btrim(coalesce(p_estado_civil,'')),''),
       nullif(btrim(coalesce(p_profesion,'')),''),
       nullif(btrim(coalesce(p_estudios_primaria,'')),''), nullif(btrim(coalesce(p_estudios_secundaria,'')),''),
       nullif(btrim(coalesce(p_estudios_tecnicos,'')),''), nullif(btrim(coalesce(p_estudios_universitarios,'')),''),
       nullif(btrim(coalesce(p_experiencia_laboral,'')),''), nullif(btrim(coalesce(p_referencias,'')),''),
       nullif(btrim(coalesce(p_emergencia_nombre,'')),''), nullif(btrim(coalesce(p_emergencia_telefono,'')),''),
       nullif(btrim(coalesce(p_emergencia_parentesco,'')),''),
       nullif(btrim(coalesce(p_afp,'')),''), nullif(btrim(coalesce(p_nua,'')),''),
       nullif(btrim(coalesce(p_caja_salud,'')),''), nullif(btrim(coalesce(p_banco,'')),''),
       nullif(btrim(coalesce(p_cuenta_bancaria,'')),''), v_contrato, p_fecha_fin_contrato)
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
           nota = nullif(btrim(coalesce(p_nota,'')),''),
           fecha_nacimiento = p_fecha_nacimiento,
           direccion = nullif(btrim(coalesce(p_direccion,'')),''),
           nacionalidad = nullif(btrim(coalesce(p_nacionalidad,'')),''),
           estado_civil = nullif(btrim(coalesce(p_estado_civil,'')),''),
           profesion = nullif(btrim(coalesce(p_profesion,'')),''),
           estudios_primaria = nullif(btrim(coalesce(p_estudios_primaria,'')),''),
           estudios_secundaria = nullif(btrim(coalesce(p_estudios_secundaria,'')),''),
           estudios_tecnicos = nullif(btrim(coalesce(p_estudios_tecnicos,'')),''),
           estudios_universitarios = nullif(btrim(coalesce(p_estudios_universitarios,'')),''),
           experiencia_laboral = nullif(btrim(coalesce(p_experiencia_laboral,'')),''),
           referencias = nullif(btrim(coalesce(p_referencias,'')),''),
           contacto_emergencia_nombre = nullif(btrim(coalesce(p_emergencia_nombre,'')),''),
           contacto_emergencia_telefono = nullif(btrim(coalesce(p_emergencia_telefono,'')),''),
           contacto_emergencia_parentesco = nullif(btrim(coalesce(p_emergencia_parentesco,'')),''),
           afp = nullif(btrim(coalesce(p_afp,'')),''),
           nua = nullif(btrim(coalesce(p_nua,'')),''),
           caja_salud = nullif(btrim(coalesce(p_caja_salud,'')),''),
           banco = nullif(btrim(coalesce(p_banco,'')),''),
           cuenta_bancaria = nullif(btrim(coalesce(p_cuenta_bancaria,'')),''),
           tipo_contrato = v_contrato, fecha_fin_contrato = p_fecha_fin_contrato,
           updated_at = now()
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'EMPLEADO_NO_ENCONTRADO'; end if;
  end if;

  perform private.audit('team', v_actor, null, 'rrhh.empleado', p_project_id,
    'hr_empleado', v_id, null,
    jsonb_build_object('codigo', p_codigo, 'cargo', p_cargo, 'salario', p_salario));
  return jsonb_build_object('id', v_id);
end;
$$;

grant execute on function public.admin_guardar_empleado(uuid, text, text, text, text, text, text, text, uuid, uuid, uuid, date, numeric, text, date, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, date) to authenticated;
revoke execute on function public.admin_guardar_empleado(uuid, text, text, text, text, text, text, text, uuid, uuid, uuid, date, numeric, text, date, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, date) from anon;

-- ---------------------------------------------------------------------------
-- Alta y baja de papeles. El archivo lo sube la ruta del panel; acá queda la
-- ficha con su ruta en el bucket.
-- ---------------------------------------------------------------------------
create or replace function public.admin_guardar_hr_documento(
  p_empleado_id uuid, p_tipo text, p_nombre text, p_storage_path text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid; v_id uuid;
begin
  v_actor := private.assert_accounting();
  if not exists (select 1 from public.hr_empleados where id = p_empleado_id) then
    raise exception 'EMPLEADO_NO_ENCONTRADO';
  end if;
  if btrim(coalesce(p_nombre,'')) = '' then raise exception 'NOMBRE_REQUERIDO'; end if;
  if btrim(coalesce(p_storage_path,'')) = '' then raise exception 'ARCHIVO_REQUERIDO'; end if;

  insert into public.hr_documentos (empleado_id, tipo, nombre, storage_path, subido_por)
  values (p_empleado_id, coalesce(nullif(btrim(coalesce(p_tipo,'')),''), 'otro'),
          btrim(p_nombre), btrim(p_storage_path), v_actor)
  returning id into v_id;

  perform private.audit('team', v_actor, null, 'rrhh.documento', null,
    'hr_documento', v_id, null, jsonb_build_object('empleado', p_empleado_id, 'tipo', p_tipo));
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.admin_borrar_hr_documento(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid; v_d public.hr_documentos%rowtype;
begin
  v_actor := private.assert_accounting();
  select * into v_d from public.hr_documentos where id = p_id;
  if v_d.id is null or v_d.deleted_at is not null then raise exception 'DOC_NO_ENCONTRADO'; end if;
  update public.hr_documentos set deleted_at = now() where id = p_id;
  perform private.audit('team', v_actor, null, 'rrhh.documento_borrado', null,
    'hr_documento', p_id, jsonb_build_object('nombre', v_d.nombre), null);
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.admin_guardar_hr_documento(uuid, text, text, text) to authenticated;
grant execute on function public.admin_borrar_hr_documento(uuid) to authenticated;
revoke execute on function public.admin_guardar_hr_documento(uuid, text, text, text) from anon;
revoke execute on function public.admin_borrar_hr_documento(uuid) from anon;
