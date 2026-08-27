-- El egreso acepta concepto; la cuenta acepta ámbito; el fiscal lo respeta.

drop function if exists public.admin_record_expense(
  uuid, date, expense_category, text, numeric, character, text, text, text, uuid, uuid,
  uuid, text, text, uuid);

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
  p_reservation_id uuid default null,
  p_concept_id uuid default null)
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
  v_cat expense_category;
begin
  v_actor := private.assert_accounting();

  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if btrim(coalesce(p_description, '')) = '' then raise exception 'DESCRIPTION_REQUIRED'; end if;
  if p_incurred_on is null or p_incurred_on > current_date + 1 then raise exception 'INVALID_DATE'; end if;

  select * into v_project from public.projects where id = p_project_id;
  if not found then raise exception 'PROJECT_NOT_FOUND'; end if;

  perform private.assert_periodo_abierto(p_project_id, p_incurred_on);

  if p_treasury_account_id is not null
     and not exists (select 1 from public.treasury_accounts
                      where id = p_treasury_account_id and is_active) then
    raise exception 'TREASURY_NOT_FOUND';
  end if;

  if p_centro_costo_id is not null
     and not exists (select 1 from public.centros_costo cc
                      where cc.id = p_centro_costo_id and cc.is_active
                        and (cc.project_id is null or cc.project_id = p_project_id)) then
    raise exception 'CENTRO_COSTO_NO_ENCONTRADO'
      using detail = 'Ese centro de costos no existe, está inactivo o es de otra urbanización.';
  end if;

  -- Si viene un concepto, él manda la familia: así el egreso cae siempre en
  -- la cuenta que el concepto declara, sin depender de lo que eligió la
  -- pantalla.
  v_cat := p_category;
  if p_concept_id is not null then
    select ec.categoria into v_cat
      from public.expense_concepts ec where ec.id = p_concept_id and ec.is_active;
    if not found then
      raise exception 'CONCEPTO_NO_ENCONTRADO'
        using detail = 'Ese concepto de egreso no existe o está inactivo.';
    end if;
  end if;

  v_titular := coalesce(nullif(btrim(coalesce(p_titular, '')), ''), 'empresa');
  if v_titular not in ('empresa','tercero') then raise exception 'TITULAR_INVALIDO'; end if;
  v_titular_nombre := nullif(btrim(coalesce(p_titular_nombre, '')), '');
  if v_titular = 'tercero' and v_titular_nombre is null then
    raise exception 'TITULAR_SIN_NOMBRE'
      using detail = 'Si el gasto está a nombre de un tercero, hay que decir de quién.';
  end if;
  if v_titular = 'empresa' then v_titular_nombre := null; end if;

  select c.name into v_supplier from public.contacts c where c.id = p_contact_id;
  v_supplier := coalesce(v_supplier, nullif(btrim(coalesce(p_supplier, '')), ''));

  v_cur := coalesce(p_currency, v_project.currency);
  v_rate := coalesce((private.get_setting(p_project_id, 'exchange_rate_bob_per_usd'))::numeric, 6.96);
  v_bob := case when v_cur = 'BOB' then p_amount else round(p_amount * v_rate, 2) end;

  insert into public.expenses
    (project_id, incurred_on, category, description, supplier, amount, currency,
     amount_bob, exchange_rate_used, receipt_storage_path, note, created_by,
     treasury_account_id, contact_id, centro_costo_id, titular, titular_nombre,
     reservation_id, concept_id)
  values
    (p_project_id, p_incurred_on, v_cat, btrim(p_description),
     v_supplier, p_amount, v_cur, v_bob, v_rate,
     p_receipt_storage_path, nullif(btrim(coalesce(p_note, '')), ''), v_actor,
     p_treasury_account_id, p_contact_id, p_centro_costo_id, v_titular, v_titular_nombre,
     p_reservation_id, p_concept_id)
  returning id into v_id;

  perform private.audit('team', v_actor, null, 'expense.created', p_project_id,
    'expense', v_id,
    null, jsonb_build_object('monto', p_amount, 'moneda', v_cur, 'categoria', v_cat,
                             'concepto', p_concept_id,
                             'fecha', p_incurred_on, 'detalle', btrim(p_description),
                             'proveedor', v_supplier, 'centro_costo', p_centro_costo_id,
                             'titular', v_titular, 'titular_nombre', v_titular_nombre));

  return jsonb_build_object('expense_id', v_id, 'amount_bob', v_bob);
end;
$function$;

-- ---------- alta y baja de conceptos ---------------------------------------
create or replace function public.admin_guardar_concepto_egreso(
  p_id uuid default null,
  p_codigo text default null,
  p_nombre text default null,
  p_categoria expense_category default null,
  p_account_code text default null,
  p_ayuda text default null,
  p_activo boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid; v_id uuid;
begin
  v_actor := private.assert_accounting();
  if btrim(coalesce(p_codigo, '')) = '' then raise exception 'CODIGO_REQUERIDO'; end if;
  if btrim(coalesce(p_nombre, '')) = '' then raise exception 'NOMBRE_REQUERIDO'; end if;
  if p_categoria is null then raise exception 'CATEGORIA_REQUERIDA'; end if;
  if p_account_code is not null
     and not exists (select 1 from public.chart_of_accounts
                      where code = p_account_code and is_active) then
    raise exception 'CUENTA_INVALIDA';
  end if;

  if p_id is null then
    insert into public.expense_concepts
      (codigo, nombre, categoria, account_code, ayuda, is_active, created_by)
    values (btrim(p_codigo), btrim(p_nombre), p_categoria, p_account_code,
            nullif(btrim(coalesce(p_ayuda,'')), ''), coalesce(p_activo, true), v_actor)
    returning id into v_id;
  else
    update public.expense_concepts
       set codigo = btrim(p_codigo), nombre = btrim(p_nombre), categoria = p_categoria,
           account_code = p_account_code, ayuda = nullif(btrim(coalesce(p_ayuda,'')), ''),
           is_active = coalesce(p_activo, true), updated_at = now()
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'CONCEPTO_NO_ENCONTRADO'; end if;
  end if;

  perform private.audit('team', v_actor, null, 'concepto_egreso.guardado', null,
    'expense_concept', v_id, null,
    jsonb_build_object('codigo', p_codigo, 'nombre', p_nombre, 'categoria', p_categoria));
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.admin_borrar_concepto_egreso(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid; v_usos int;
begin
  v_actor := private.assert_accounting();
  select count(*) into v_usos from public.expenses
   where concept_id = p_id and deleted_at is null;
  if v_usos > 0 then
    -- Un concepto con gastos cargados no se borra: se desactiva. Borrarlo
    -- dejaría egresos históricos sin explicación de qué eran.
    update public.expense_concepts set is_active = false, updated_at = now() where id = p_id;
    perform private.audit('team', v_actor, null, 'concepto_egreso.desactivado', null,
      'expense_concept', p_id, null, jsonb_build_object('usos', v_usos));
    return jsonb_build_object('ok', true, 'accion', 'desactivado', 'usos', v_usos);
  end if;
  delete from public.expense_concepts where id = p_id;
  perform private.audit('team', v_actor, null, 'concepto_egreso.borrado', null,
    'expense_concept', p_id, null, null);
  return jsonb_build_object('ok', true, 'accion', 'borrado');
end;
$$;

-- ---------- el ámbito, en el alta de cuentas --------------------------------
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_upsert_treasury';
  if position('p_is_active boolean DEFAULT true' in v_def) = 0 then
    raise exception 'ANCLA_TESORERIA_NO_ENCONTRADA';
  end if;
  v_def := replace(v_def, 'p_is_active boolean DEFAULT true',
                          'p_is_active boolean DEFAULT true, p_ambito text DEFAULT NULL');
  execute v_def;
end $$;

create or replace function public.admin_cuenta_ambito(p_id uuid, p_ambito text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid; v_antes text;
begin
  v_actor := private.assert_accounting();
  if p_ambito not in ('gerencial','fiscal') then raise exception 'AMBITO_INVALIDO'; end if;
  select ambito into v_antes from public.treasury_accounts where id = p_id;
  if v_antes is null then raise exception 'TREASURY_NOT_FOUND'; end if;
  update public.treasury_accounts set ambito = p_ambito, updated_at = now() where id = p_id;
  perform private.audit('team', v_actor, null, 'tesoreria.ambito', null,
    'treasury_account', p_id, jsonb_build_object('ambito', v_antes),
    jsonb_build_object('ambito', p_ambito));
  return jsonb_build_object('ok', true, 'ambito', p_ambito);
end;
$$;

do $$
declare f text;
begin
  for f in select unnest(array[
    'admin_guardar_concepto_egreso(uuid, text, text, expense_category, text, text, boolean)',
    'admin_borrar_concepto_egreso(uuid)',
    'admin_cuenta_ambito(uuid, text)'])
  loop
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('revoke execute on function public.%s from anon', f);
  end loop;
end $$;
