-- El egreso ahora dice a qué centro carga, a nombre de quién está y —si
-- corresponde— de qué cliente es.
--
-- Se BORRA la firma vieja antes de crear la nueva. Dejar las dos vivas fue
-- exactamente el bug que apareció hoy con admin_create_installment_plan:
-- Postgres las ve como funciones distintas y cualquier llamada con los
-- argumentos de antes muere con «function is not unique».

drop function if exists public.admin_record_expense(
  uuid, date, expense_category, text, numeric, character, text, text, text, uuid, uuid);

create or replace function public.admin_record_expense(
  p_project_id uuid,
  p_incurred_on date,
  p_category expense_category,
  p_description text,
  p_amount numeric,
  p_currency character default null,
  p_supplier text default null,
  p_receipt_storage_path text default null,
  p_note text default null,
  p_treasury_account_id uuid default null,
  p_contact_id uuid default null,
  p_centro_costo_id uuid default null,
  p_titular text default 'empresa',
  p_titular_nombre text default null,
  p_reservation_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $function$
declare
  v_actor uuid;
  v_project public.projects%rowtype;
  v_cur char(3);
  v_rate numeric(10,4);
  v_bob numeric(12,2);
  v_id uuid;
  v_supplier text;
  v_titular text;
  v_titular_nombre text;
begin
  v_actor := private.assert_accounting();

  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if btrim(coalesce(p_description, '')) = '' then raise exception 'DESCRIPTION_REQUIRED'; end if;
  if p_incurred_on is null or p_incurred_on > current_date + 1 then raise exception 'INVALID_DATE'; end if;

  select * into v_project from public.projects where id = p_project_id;
  if not found then raise exception 'PROJECT_NOT_FOUND'; end if;

  -- Un egreso con fecha dentro de una gestión ya cerrada cambiaría estados
  -- contables que ya se firmaron y presentaron.
  perform private.assert_periodo_abierto(p_project_id, p_incurred_on);

  if p_treasury_account_id is not null
     and not exists (select 1 from public.treasury_accounts
                      where id = p_treasury_account_id and is_active) then
    raise exception 'TREASURY_NOT_FOUND';
  end if;

  -- El centro de costos tiene que ser de esta urbanización o de toda la
  -- empresa: cargarle a la etapa 2 un gasto de otro barrio miente el costo.
  if p_centro_costo_id is not null
     and not exists (select 1 from public.centros_costo cc
                      where cc.id = p_centro_costo_id and cc.is_active
                        and (cc.project_id is null or cc.project_id = p_project_id)) then
    raise exception 'CENTRO_COSTO_NO_ENCONTRADO'
      using detail = 'Ese centro de costos no existe, está inactivo o es de otra urbanización.';
  end if;

  v_titular := coalesce(nullif(btrim(coalesce(p_titular, '')), ''), 'empresa');
  if v_titular not in ('empresa','tercero') then raise exception 'TITULAR_INVALIDO'; end if;
  v_titular_nombre := nullif(btrim(coalesce(p_titular_nombre, '')), '');
  if v_titular = 'tercero' and v_titular_nombre is null then
    raise exception 'TITULAR_SIN_NOMBRE'
      using detail = 'Si el gasto está a nombre de un tercero, hay que decir de quién.';
  end if;
  if v_titular = 'empresa' then v_titular_nombre := null; end if;

  -- Si viene del directorio, el nombre del proveedor sale de ahí: se guarda
  -- igual en supplier para que los reportes viejos y los CSV no queden vacíos.
  select c.name into v_supplier from public.contacts c where c.id = p_contact_id;
  v_supplier := coalesce(v_supplier, nullif(btrim(coalesce(p_supplier, '')), ''));

  v_cur := coalesce(p_currency, v_project.currency);
  v_rate := coalesce((private.get_setting(p_project_id, 'exchange_rate_bob_per_usd'))::numeric, 6.96);
  v_bob := case when v_cur = 'BOB' then p_amount else round(p_amount * v_rate, 2) end;

  insert into public.expenses
    (project_id, incurred_on, category, description, supplier, amount, currency,
     amount_bob, exchange_rate_used, receipt_storage_path, note, created_by,
     treasury_account_id, contact_id, centro_costo_id, titular, titular_nombre,
     reservation_id)
  values
    (p_project_id, p_incurred_on, p_category, btrim(p_description),
     v_supplier, p_amount, v_cur, v_bob, v_rate,
     p_receipt_storage_path, nullif(btrim(coalesce(p_note, '')), ''), v_actor,
     p_treasury_account_id, p_contact_id, p_centro_costo_id, v_titular, v_titular_nombre,
     p_reservation_id)
  returning id into v_id;

  perform private.audit('team', v_actor, null, 'expense.created', p_project_id,
    'expense', v_id,
    null, jsonb_build_object('monto', p_amount, 'moneda', v_cur, 'categoria', p_category,
                             'fecha', p_incurred_on, 'detalle', btrim(p_description),
                             'proveedor', v_supplier, 'centro_costo', p_centro_costo_id,
                             'titular', v_titular, 'titular_nombre', v_titular_nombre));

  return jsonb_build_object('expense_id', v_id, 'amount_bob', v_bob);
end;
$function$;

-- ---------- alta y baja de centros de costo --------------------------------
create or replace function public.admin_guardar_centro_costo(
  p_id uuid default null,
  p_project_id uuid default null,
  p_codigo text default null,
  p_nombre text default null,
  p_activo boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_actor uuid;
  v_id uuid;
begin
  v_actor := private.assert_accounting();
  if btrim(coalesce(p_codigo, '')) = '' then raise exception 'CODIGO_REQUERIDO'; end if;
  if btrim(coalesce(p_nombre, '')) = '' then raise exception 'NOMBRE_REQUERIDO'; end if;
  if p_project_id is not null
     and not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  if p_id is null then
    insert into public.centros_costo (project_id, codigo, nombre, is_active, created_by)
    values (p_project_id, btrim(p_codigo), btrim(p_nombre), coalesce(p_activo, true), v_actor)
    returning id into v_id;
  else
    update public.centros_costo
       set project_id = p_project_id, codigo = btrim(p_codigo), nombre = btrim(p_nombre),
           is_active = coalesce(p_activo, true), updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'CENTRO_COSTO_NO_ENCONTRADO'; end if;
  end if;

  perform private.audit('team', v_actor, null, 'centro_costo.guardado', p_project_id,
    'centro_costo', v_id, null,
    jsonb_build_object('codigo', p_codigo, 'nombre', p_nombre, 'activo', p_activo));

  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.admin_borrar_centro_costo(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_actor uuid;
  v_usos int;
begin
  v_actor := private.assert_accounting();

  -- Un centro que ya tiene plata cargada no se borra: se desactiva. Borrarlo
  -- dejaría gastos históricos apuntando al vacío y el costo de esa etapa
  -- dejaría de cuadrar hacia atrás.
  select (select count(*) from public.expenses where centro_costo_id = p_id and deleted_at is null)
       + (select count(*) from public.journal_entries where centro_costo_id = p_id)
    into v_usos;

  if v_usos > 0 then
    update public.centros_costo set is_active = false, updated_at = now() where id = p_id;
    perform private.audit('team', v_actor, null, 'centro_costo.desactivado', null,
      'centro_costo', p_id, null, jsonb_build_object('usos', v_usos));
    return jsonb_build_object('ok', true, 'accion', 'desactivado', 'usos', v_usos);
  end if;

  delete from public.centros_costo where id = p_id;
  perform private.audit('team', v_actor, null, 'centro_costo.borrado', null,
    'centro_costo', p_id, null, null);
  return jsonb_build_object('ok', true, 'accion', 'borrado');
end;
$$;

grant execute on function public.admin_guardar_centro_costo(uuid, uuid, text, text, boolean) to authenticated;
grant execute on function public.admin_borrar_centro_costo(uuid) to authenticated;
revoke execute on function public.admin_guardar_centro_costo(uuid, uuid, text, text, boolean) from anon;
revoke execute on function public.admin_borrar_centro_costo(uuid) from anon;
