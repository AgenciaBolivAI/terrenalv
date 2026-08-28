-- REGISTRAR A CRÉDITO, PAGAR, Y VER LO QUE SE DEBE.

-- 1. Las dos cuentas nuevas las mueve el sistema, como 1131 o 4111: si además
--    se pudieran asentar a mano, el saldo de proveedores dejaría de ser
--    exactamente «las facturas sin pagar» y los guardianes nuevos mentirían.
do $$
declare v_def text; v_ancla text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_save_voucher';
  v_ancla := '(''1131'',''2131'',''4111'',''4211'',''4311'',''4411'',''1151'',''5121'')';
  if position(v_ancla in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA' using detail = 'admin_save_voucher ya no lista las cuentas del sistema como se esperaba.';
  end if;
  execute replace(v_def, v_ancla,
    '(''1131'',''2131'',''4111'',''4211'',''4311'',''4411'',''1151'',''5121'',''2.01.04.010'',''1.02.04.030'')');
end $$;

-- 2. El egreso, con forma de pago y factura.
drop function if exists public.admin_record_expense(uuid, date, expense_category, text, numeric, character, text, text, text, uuid, uuid, uuid, text, text, uuid, uuid);

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
  p_concept_id uuid default null,
  p_numero_factura text default null,
  p_forma_pago text default 'contado',
  p_vencimiento date default null,
  p_fondo_empleado_id uuid default null)
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
  v_forma text;
  v_saldo numeric;
  v_emp public.hr_empleados%rowtype;
begin
  v_actor := private.assert_contabilidad();

  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if btrim(coalesce(p_description, '')) = '' then raise exception 'DESCRIPTION_REQUIRED'; end if;
  if p_incurred_on is null or p_incurred_on > current_date + 1 then raise exception 'INVALID_DATE'; end if;

  select * into v_project from public.projects where id = p_project_id;
  if not found then raise exception 'PROJECT_NOT_FOUND'; end if;

  perform private.assert_periodo_abierto(p_project_id, p_incurred_on);

  v_forma := coalesce(nullif(btrim(coalesce(p_forma_pago, '')), ''), 'contado');
  if v_forma not in ('contado','credito','fondos_por_rendir') then
    raise exception 'FORMA_DE_PAGO_INVALIDA';
  end if;
  if v_forma <> 'contado' and p_treasury_account_id is not null then
    raise exception 'CREDITO_NO_LLEVA_CAJA'
      using detail = 'Si no se pagó al contado, todavía no salió plata de ninguna cuenta.';
  end if;
  if v_forma = 'credito' and p_vencimiento is null then
    raise exception 'VENCIMIENTO_REQUERIDO'
      using detail = 'Una compra a crédito necesita fecha de vencimiento.';
  end if;

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

  -- Nadie rinde más de lo que se le entregó.
  if v_forma = 'fondos_por_rendir' then
    if p_fondo_empleado_id is null then
      raise exception 'EMPLEADO_REQUERIDO'
        using detail = 'Decinos de qué fondo sale este gasto.';
    end if;
    select * into v_emp from public.hr_empleados where id = p_fondo_empleado_id;
    if v_emp.id is null then raise exception 'EMPLEADO_NO_ENCONTRADO'; end if;
    select coalesce(sum(case tipo when 'entrega' then monto else -monto end), 0)
      into v_saldo from public.fondos_a_rendir
     where empleado_id = p_fondo_empleado_id and deleted_at is null;
    v_saldo := v_saldo - coalesce((select sum(amount_bob) from public.expenses
                                    where deleted_at is null
                                      and forma_pago = 'fondos_por_rendir'
                                      and fondo_empleado_id = p_fondo_empleado_id), 0);
    if v_bob > round(v_saldo, 2) then
      raise exception 'FONDO_INSUFICIENTE'
        using detail = format('El fondo de %s tiene Bs %s.', v_emp.nombre_completo, round(v_saldo, 2));
    end if;
  end if;

  insert into public.expenses
    (project_id, incurred_on, category, description, supplier, amount, currency,
     amount_bob, exchange_rate_used, receipt_storage_path, note, created_by,
     treasury_account_id, contact_id, centro_costo_id, titular, titular_nombre,
     reservation_id, concept_id, numero_factura, forma_pago, vencimiento, fondo_empleado_id)
  values
    (p_project_id, p_incurred_on, v_cat, btrim(p_description),
     v_supplier, p_amount, v_cur, v_bob, v_rate,
     p_receipt_storage_path, nullif(btrim(coalesce(p_note, '')), ''), v_actor,
     case when v_forma = 'contado' then p_treasury_account_id end,
     p_contact_id, p_centro_costo_id, v_titular, v_titular_nombre,
     p_reservation_id, p_concept_id,
     nullif(btrim(coalesce(p_numero_factura, '')), ''), v_forma,
     case when v_forma = 'credito' then p_vencimiento end,
     case when v_forma = 'fondos_por_rendir' then p_fondo_empleado_id end)
  returning id into v_id;

  perform private.audit('team', v_actor, null, 'expense.created', p_project_id,
    'expense', v_id,
    null, jsonb_build_object('monto', p_amount, 'moneda', v_cur, 'categoria', v_cat,
                             'concepto', p_concept_id,
                             'fecha', p_incurred_on, 'detalle', btrim(p_description),
                             'proveedor', v_supplier, 'centro_costo', p_centro_costo_id,
                             'titular', v_titular, 'titular_nombre', v_titular_nombre,
                             'forma_pago', v_forma, 'factura', p_numero_factura));

  return jsonb_build_object('expense_id', v_id, 'amount_bob', v_bob);
end;
$function$;

grant execute on function public.admin_record_expense(uuid, date, expense_category, text, numeric, character, text, text, text, uuid, uuid, uuid, text, text, uuid, uuid, text, text, date, uuid) to authenticated;
revoke execute on function public.admin_record_expense(uuid, date, expense_category, text, numeric, character, text, text, text, uuid, uuid, uuid, text, text, uuid, uuid, text, text, date, uuid) from anon;

-- 3. Cancelar la deuda: del egreso y del activo.
create or replace function public.admin_pagar_egreso(
  p_expense_id uuid, p_treasury_account_id uuid, p_fecha date default current_date)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid; v_e public.expenses%rowtype; v_fecha date;
begin
  v_actor := private.assert_contabilidad();
  select * into v_e from public.expenses where id = p_expense_id for update;
  if v_e.id is null or v_e.deleted_at is not null then raise exception 'EGRESO_NO_ENCONTRADO'; end if;
  if v_e.forma_pago <> 'credito' then
    raise exception 'EGRESO_NO_ES_A_CREDITO'
      using detail = 'Ese egreso no quedó debiéndose: no hay nada que cancelar.';
  end if;
  if v_e.pagado_el is not null then raise exception 'EGRESO_YA_PAGADO'; end if;
  if not exists (select 1 from public.treasury_accounts where id = p_treasury_account_id and is_active) then
    raise exception 'TREASURY_NOT_FOUND';
  end if;
  v_fecha := coalesce(p_fecha, current_date);
  if v_fecha < v_e.incurred_on then
    raise exception 'FECHA_INVALIDA' using detail = 'No se puede pagar antes de la fecha del gasto.';
  end if;
  perform private.assert_periodo_abierto(v_e.project_id, v_fecha);

  update public.expenses
     set pagado_el = v_fecha, pagado_de = p_treasury_account_id, updated_at = now()
   where id = p_expense_id;

  perform private.audit('team', v_actor, null, 'egreso.pagado', v_e.project_id,
    'expense', p_expense_id, null,
    jsonb_build_object('numero', v_e.numero, 'monto', v_e.amount_bob, 'fecha', v_fecha));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_anular_pago_de_egreso(p_expense_id uuid, p_nota text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid; v_e public.expenses%rowtype;
begin
  v_actor := private.assert_contabilidad();
  if btrim(coalesce(p_nota, '')) = '' then raise exception 'NOTE_REQUIRED'; end if;
  select * into v_e from public.expenses where id = p_expense_id for update;
  if v_e.id is null or v_e.deleted_at is not null then raise exception 'EGRESO_NO_ENCONTRADO'; end if;
  if v_e.pagado_el is null then raise exception 'EGRESO_NO_ESTA_PAGADO'; end if;
  perform private.assert_periodo_abierto(v_e.project_id, v_e.pagado_el);

  update public.expenses
     set pagado_el = null, pagado_de = null,
         note = coalesce(note || ' · ', '') || 'Pago anulado: ' || btrim(p_nota),
         updated_at = now()
   where id = p_expense_id;

  perform private.audit('team', v_actor, null, 'egreso.pago_anulado', v_e.project_id,
    'expense', p_expense_id, jsonb_build_object('pagado_el', v_e.pagado_el),
    jsonb_build_object('nota', btrim(p_nota)));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_pagar_activo(
  p_activo_id uuid, p_treasury_account_id uuid, p_fecha date default current_date)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid; v_a public.fixed_assets%rowtype; v_fecha date;
begin
  v_actor := private.assert_contabilidad();
  select * into v_a from public.fixed_assets where id = p_activo_id for update;
  if v_a.id is null then raise exception 'ACTIVO_NO_ENCONTRADO'; end if;
  if v_a.forma_pago <> 'credito' then
    raise exception 'ACTIVO_NO_ES_A_CREDITO'
      using detail = 'Ese activo no quedó debiéndose: no hay nada que cancelar.';
  end if;
  if v_a.pagado_el is not null then raise exception 'ACTIVO_YA_PAGADO'; end if;
  if not exists (select 1 from public.treasury_accounts where id = p_treasury_account_id and is_active) then
    raise exception 'TREASURY_NOT_FOUND';
  end if;
  v_fecha := coalesce(p_fecha, current_date);
  if v_fecha < v_a.fecha_compra then
    raise exception 'FECHA_INVALIDA' using detail = 'No se puede pagar antes de la compra.';
  end if;
  perform private.assert_periodo_abierto(v_a.project_id, v_fecha);

  update public.fixed_assets
     set pagado_el = v_fecha, pagado_de = p_treasury_account_id, updated_at = now()
   where id = p_activo_id;

  perform private.audit('team', v_actor, null, 'activo.pagado', v_a.project_id,
    'fixed_asset', p_activo_id, null,
    jsonb_build_object('codigo', v_a.codigo, 'monto', v_a.costo, 'fecha', v_fecha));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_anular_pago_de_activo(p_activo_id uuid, p_nota text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid; v_a public.fixed_assets%rowtype;
begin
  v_actor := private.assert_contabilidad();
  if btrim(coalesce(p_nota, '')) = '' then raise exception 'NOTE_REQUIRED'; end if;
  select * into v_a from public.fixed_assets where id = p_activo_id for update;
  if v_a.id is null then raise exception 'ACTIVO_NO_ENCONTRADO'; end if;
  if v_a.pagado_el is null then raise exception 'ACTIVO_NO_ESTA_PAGADO'; end if;
  perform private.assert_periodo_abierto(v_a.project_id, v_a.pagado_el);

  update public.fixed_assets
     set pagado_el = null, pagado_de = null,
         nota = coalesce(nota || ' · ', '') || 'Pago anulado: ' || btrim(p_nota),
         updated_at = now()
   where id = p_activo_id;

  perform private.audit('team', v_actor, null, 'activo.pago_anulado', v_a.project_id,
    'fixed_asset', p_activo_id, jsonb_build_object('pagado_el', v_a.pagado_el),
    jsonb_build_object('nota', btrim(p_nota)));
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.admin_pagar_egreso(uuid, uuid, date) to authenticated;
grant execute on function public.admin_anular_pago_de_egreso(uuid, text) to authenticated;
grant execute on function public.admin_pagar_activo(uuid, uuid, date) to authenticated;
grant execute on function public.admin_anular_pago_de_activo(uuid, text) to authenticated;
revoke execute on function public.admin_pagar_egreso(uuid, uuid, date) from anon;
revoke execute on function public.admin_anular_pago_de_egreso(uuid, text) from anon;
revoke execute on function public.admin_pagar_activo(uuid, uuid, date) from anon;
revoke execute on function public.admin_anular_pago_de_activo(uuid, text) from anon;

-- 4. Lo que se debe, en una sola lista: facturas de gasto y activos comprados
--    a crédito que todavía no se pagaron.
create or replace view public.v_cuentas_por_pagar as
select e.id,
       'egreso'::text as tipo,
       e.project_id,
       p.name as proyecto,
       coalesce(c.name, e.supplier) as proveedor,
       c.tax_id as proveedor_nit,
       e.numero as numero,
       e.numero_factura,
       e.description as detalle,
       e.incurred_on as fecha,
       e.vencimiento,
       e.amount_bob as monto,
       greatest(0, current_date - e.vencimiento) as dias_vencido
  from public.expenses e
  join public.projects p on p.id = e.project_id
  left join public.contacts c on c.id = e.contact_id
 where e.deleted_at is null and e.forma_pago = 'credito' and e.pagado_el is null
   and private.ve_contabilidad()
union all
select a.id,
       'activo'::text,
       a.project_id,
       p.name,
       pv.name,
       pv.tax_id,
       'ACT-' || a.codigo,
       a.numero_factura,
       a.nombre,
       a.fecha_compra,
       a.vencimiento,
       a.costo,
       greatest(0, current_date - a.vencimiento)
  from public.fixed_assets a
  join public.projects p on p.id = a.project_id
  left join public.contacts pv on pv.id = a.proveedor_contact_id
 where a.forma_pago = 'credito' and a.pagado_el is null and a.expense_id is null
   and private.ve_contabilidad();

alter view public.v_cuentas_por_pagar set (security_invoker = true);
grant select on public.v_cuentas_por_pagar to authenticated;
revoke all on public.v_cuentas_por_pagar from anon;

comment on view public.v_cuentas_por_pagar is
  'Lo que la empresa debe a proveedores: egresos y activos comprados a '
  'crédito, sin pagar. Su total tiene que ser el saldo de 2.01.04.010 — hay '
  'un guardián que lo comprueba.';
