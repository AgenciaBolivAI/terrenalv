-- EL ACTIVO FIJO: FACTURA, FORMA DE PAGO Y CÓMO TERMINA.
--
-- La contadora, mirando el formulario: «falta para colocar datos, número de
-- factura, datos del proveedor (tipo kardex). También las cuentas contables
-- que serán relacionadas o afectadas si se pagó al contado o crédito».
--
-- Tenía razón dos veces. La primera es la que se ve: no había factura, y el
-- proveedor existía en la tabla pero el formulario mandaba null. La segunda no
-- se ve y es peor: **registrar un activo no asentaba NADA**. La compra no
-- entraba al libro. Solo la depreciación mensual asentaba (5811 contra 1290),
-- así que la depreciación acumulada crecía contra un activo que el balance
-- nunca había reconocido, y las cuentas 1241–1249 no las debitaba nadie.
--
-- Acá van las columnas. El asiento de compra, el de pago al proveedor y el de
-- baja los arma el diario en la migración que viene.
--
-- `dep_acumulada_baja` se CONGELA al dar de baja, con la misma aritmética que
-- usa la vista. Si se recalculara al leer, el asiento de una baja de hace dos
-- años cambiaría solo, cada mes.

alter table public.fixed_assets
  add column if not exists numero_factura text,
  add column if not exists forma_pago text not null default 'contado',
  add column if not exists vencimiento date,
  add column if not exists treasury_account_id uuid references public.treasury_accounts (id),
  add column if not exists pagado_el date,
  add column if not exists pagado_de uuid references public.treasury_accounts (id),
  add column if not exists venta_treasury_account_id uuid references public.treasury_accounts (id),
  add column if not exists dep_acumulada_baja numeric(14,2);

comment on column public.fixed_assets.dep_acumulada_baja is
  'La depreciación acumulada al día de la baja, congelada. El asiento de baja '
  'la usa para cancelar 1290; recalcularla al leer haría cambiar un asiento '
  'viejo cada mes.';

alter table public.fixed_assets drop constraint if exists fixed_assets_forma_pago_check;
alter table public.fixed_assets add constraint fixed_assets_forma_pago_check
  check (forma_pago in ('contado','credito'));

alter table public.fixed_assets drop constraint if exists fixed_assets_credito_check;
alter table public.fixed_assets add constraint fixed_assets_credito_check
  check (forma_pago = 'credito' or (vencimiento is null and pagado_el is null and pagado_de is null));

alter table public.fixed_assets drop constraint if exists fixed_assets_tesoreria_check;
alter table public.fixed_assets add constraint fixed_assets_tesoreria_check
  check (forma_pago = 'contado' or treasury_account_id is null);

alter table public.fixed_assets drop constraint if exists fixed_assets_pago_completo_check;
alter table public.fixed_assets add constraint fixed_assets_pago_completo_check
  check (pagado_el is null or pagado_de is not null);

alter table public.fixed_assets drop constraint if exists fixed_assets_pago_fecha_check;
alter table public.fixed_assets add constraint fixed_assets_pago_fecha_check
  check (pagado_el is null or pagado_el >= fecha_compra);

-- Un activo vivo no tiene acumulada congelada; uno de baja la tiene siempre.
alter table public.fixed_assets drop constraint if exists fixed_assets_acumulada_baja_check;
alter table public.fixed_assets add constraint fixed_assets_acumulada_baja_check
  check ((estado = 'activo') = (dep_acumulada_baja is null));

alter table public.fixed_assets drop constraint if exists fixed_assets_acumulada_rango_check;
alter table public.fixed_assets add constraint fixed_assets_acumulada_rango_check
  check (dep_acumulada_baja is null
         or (dep_acumulada_baja >= 0 and dep_acumulada_baja <= costo - valor_residual));

-- Cada fila del diario necesita urbanización. El activo que no es de ninguna
-- —la computadora de la oficina— es de Administración.
update public.fixed_assets set project_id = private.proyecto_administracion()
 where project_id is null;
alter table public.fixed_assets alter column project_id set not null;

-- ---------------------------------------------------------------------------
-- Alta y edición, con lo nuevo. La firma vieja se cae para que no queden dos.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_guardar_activo(uuid, uuid, uuid, text, text, text, text, date, date, numeric, numeric, int, uuid, uuid, uuid, text, text, text);

create or replace function public.admin_guardar_activo(
  p_id uuid default null,
  p_project_id uuid default null,
  p_categoria_id uuid default null,
  p_codigo text default null,
  p_nombre text default null,
  p_descripcion text default null,
  p_identificacion text default null,
  p_fecha_compra date default null,
  p_fecha_alta date default null,
  p_costo numeric default null,
  p_valor_residual numeric default 0,
  p_vida_util_meses int default null,
  p_centro_costo_id uuid default null,
  p_proveedor_contact_id uuid default null,
  p_expense_id uuid default null,
  p_titular text default 'empresa',
  p_titular_nombre text default null,
  p_nota text default null,
  p_numero_factura text default null,
  p_forma_pago text default 'contado',
  p_vencimiento date default null,
  p_treasury_account_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_actor uuid; v_id uuid; v_vida int; v_titular text; v_nombre text;
  v_proj uuid; v_forma text; v_cuenta_activo text; v_cuenta_egreso text;
  v_previo public.fixed_assets%rowtype;
begin
  v_actor := private.assert_accounting();
  if btrim(coalesce(p_codigo,'')) = '' then raise exception 'CODIGO_REQUERIDO'; end if;
  if btrim(coalesce(p_nombre,'')) = '' then raise exception 'NOMBRE_REQUERIDO'; end if;
  if p_costo is null or p_costo <= 0 then raise exception 'COSTO_INVALIDO'; end if;
  if coalesce(p_valor_residual,0) < 0 or coalesce(p_valor_residual,0) >= p_costo then
    raise exception 'RESIDUAL_INVALIDO'
      using detail = 'El valor residual tiene que ser menor al costo.';
  end if;
  if p_fecha_compra is null then raise exception 'FECHA_REQUERIDA'; end if;

  -- Sin urbanización, es de Administración.
  v_proj := coalesce(p_project_id, private.proyecto_administracion());

  select vida_util_meses, cuenta_activo into v_vida, v_cuenta_activo
    from public.asset_categories where id = p_categoria_id and is_active;
  if v_vida is null then raise exception 'CATEGORIA_NO_ENCONTRADA'; end if;
  v_vida := coalesce(p_vida_util_meses, v_vida);

  v_forma := coalesce(nullif(btrim(coalesce(p_forma_pago,'')),''), 'contado');
  if v_forma not in ('contado','credito') then raise exception 'FORMA_DE_PAGO_INVALIDA'; end if;
  if v_forma = 'credito' and p_treasury_account_id is not null then
    raise exception 'CREDITO_NO_LLEVA_CAJA'
      using detail = 'Si se compró a crédito, todavía no salió plata de ninguna cuenta.';
  end if;
  if p_treasury_account_id is not null
     and not exists (select 1 from public.treasury_accounts t
                      where t.id = p_treasury_account_id and t.is_active) then
    raise exception 'CUENTA_NO_ENCONTRADA';
  end if;

  v_titular := coalesce(nullif(btrim(coalesce(p_titular,'')),''), 'empresa');
  if v_titular not in ('empresa','tercero') then raise exception 'TITULAR_INVALIDO'; end if;
  v_nombre := nullif(btrim(coalesce(p_titular_nombre,'')),'');
  if v_titular = 'tercero' and v_nombre is null then raise exception 'TITULAR_SIN_NOMBRE'; end if;
  if v_titular = 'empresa' then v_nombre := null; end if;

  -- Si el activo nace de un egreso, ese egreso YA movió la plata. Para no
  -- asentar la compra dos veces, el egreso tiene que haber capitalizado en la
  -- misma cuenta de activo de la categoría.
  if p_expense_id is not null then
    select coalesce(ec.account_code, '') into v_cuenta_egreso
      from public.expenses e
      left join public.expense_concepts ec on ec.id = e.concept_id
     where e.id = p_expense_id and e.deleted_at is null;
    if v_cuenta_egreso is null then raise exception 'EGRESO_NO_ENCONTRADO'; end if;
    if v_cuenta_egreso is distinct from coalesce(v_cuenta_activo, '1249') then
      raise exception 'EGRESO_NO_CAPITALIZA'
        using detail = format('Ese egreso carga a %s y la categoría del activo es %s. '
                              'O se corrige el concepto del egreso, o el activo se registra suelto.',
                              coalesce(nullif(v_cuenta_egreso,''),'un gasto'),
                              coalesce(v_cuenta_activo,'1249'));
    end if;
  end if;

  -- Registrar un activo ahora ASIENTA su compra: la gestión tiene que estar abierta.
  perform private.assert_periodo_abierto(v_proj, p_fecha_compra);

  if p_id is null then
    insert into public.fixed_assets
      (project_id, categoria_id, codigo, nombre, descripcion, identificacion,
       fecha_compra, fecha_alta, costo, valor_residual, vida_util_meses,
       centro_costo_id, proveedor_contact_id, expense_id, titular, titular_nombre,
       nota, numero_factura, forma_pago, vencimiento, treasury_account_id, created_by)
    values (v_proj, p_categoria_id, btrim(p_codigo), btrim(p_nombre),
       nullif(btrim(coalesce(p_descripcion,'')),''), nullif(btrim(coalesce(p_identificacion,'')),''),
       p_fecha_compra, coalesce(p_fecha_alta, p_fecha_compra), p_costo,
       coalesce(p_valor_residual,0), v_vida, p_centro_costo_id, p_proveedor_contact_id,
       p_expense_id, v_titular, v_nombre, nullif(btrim(coalesce(p_nota,'')),''),
       nullif(btrim(coalesce(p_numero_factura,'')),''), v_forma,
       case when v_forma = 'credito' then p_vencimiento end,
       case when v_forma = 'contado' then p_treasury_account_id end, v_actor)
    returning id into v_id;
  else
    select * into v_previo from public.fixed_assets where id = p_id for update;
    if v_previo.id is null then raise exception 'ACTIVO_NO_ENCONTRADO'; end if;
    if v_previo.estado <> 'activo' then
      raise exception 'ACTIVO_DADO_DE_BAJA'
        using detail = 'Un activo dado de baja no se edita: su asiento ya está cerrado.';
    end if;
    -- Mover la compra fuera de una gestión cerrada tampoco vale.
    perform private.assert_periodo_abierto(v_previo.project_id, v_previo.fecha_compra);
    if v_previo.pagado_el is not null
       and (v_forma is distinct from v_previo.forma_pago or p_costo is distinct from v_previo.costo) then
      raise exception 'ACTIVO_YA_PAGADO'
        using detail = 'Ya se le pagó al proveedor: anulá el pago antes de cambiar costo o forma.';
    end if;

    update public.fixed_assets
       set project_id = v_proj, categoria_id = p_categoria_id, codigo = btrim(p_codigo),
           nombre = btrim(p_nombre), descripcion = nullif(btrim(coalesce(p_descripcion,'')),''),
           identificacion = nullif(btrim(coalesce(p_identificacion,'')),''),
           fecha_compra = p_fecha_compra, fecha_alta = coalesce(p_fecha_alta, p_fecha_compra),
           costo = p_costo, valor_residual = coalesce(p_valor_residual,0),
           vida_util_meses = v_vida, centro_costo_id = p_centro_costo_id,
           proveedor_contact_id = p_proveedor_contact_id,
           expense_id = p_expense_id,
           titular = v_titular, titular_nombre = v_nombre,
           nota = nullif(btrim(coalesce(p_nota,'')),''),
           numero_factura = nullif(btrim(coalesce(p_numero_factura,'')),''),
           forma_pago = v_forma,
           vencimiento = case when v_forma = 'credito' then p_vencimiento end,
           treasury_account_id = case when v_forma = 'contado' then p_treasury_account_id end,
           updated_at = now()
     where id = p_id returning id into v_id;
  end if;

  perform private.audit('team', v_actor, null, 'activo.guardado', v_proj,
    'fixed_asset', v_id, null,
    jsonb_build_object('codigo', p_codigo, 'costo', p_costo, 'vida_meses', v_vida,
                       'forma_pago', v_forma, 'factura', p_numero_factura));
  return jsonb_build_object('id', v_id, 'vida_util_meses', v_vida);
end;
$$;

-- ---------------------------------------------------------------------------
-- La baja congela la acumulada y guarda de qué cuenta entró la venta.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_dar_de_baja_activo(uuid, date, text, numeric);

create or replace function public.admin_dar_de_baja_activo(
  p_id uuid, p_fecha date, p_motivo text, p_valor_venta numeric default null,
  p_venta_treasury_account_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid; v_a public.fixed_assets%rowtype; v_meses int; v_acum numeric; v_fecha date;
begin
  v_actor := private.assert_accounting();
  if btrim(coalesce(p_motivo,'')) = '' then raise exception 'NOTE_REQUIRED'; end if;
  select * into v_a from public.fixed_assets where id = p_id for update;
  if not found then raise exception 'ACTIVO_NO_ENCONTRADO'; end if;
  if v_a.estado <> 'activo' then raise exception 'YA_DADO_DE_BAJA'; end if;
  v_fecha := coalesce(p_fecha, current_date);
  if v_fecha < v_a.fecha_alta then
    raise exception 'FECHA_INVALIDA'
      using detail = 'No se puede dar de baja antes de darlo de alta.';
  end if;
  if coalesce(p_valor_venta,0) > 0 and p_venta_treasury_account_id is not null
     and not exists (select 1 from public.treasury_accounts t
                      where t.id = p_venta_treasury_account_id and t.is_active) then
    raise exception 'CUENTA_NO_ENCONTRADA';
  end if;
  perform private.assert_periodo_abierto(v_a.project_id, v_fecha);

  -- La misma cuenta que hace la vista, ni un centavo distinto.
  v_meses := least(v_a.vida_util_meses, private.meses_completos(v_a.fecha_alta, v_fecha));
  v_acum := case when v_meses >= v_a.vida_util_meses
                 then round(v_a.costo - v_a.valor_residual, 2)
                 else round(round((v_a.costo - v_a.valor_residual) / v_a.vida_util_meses, 2) * v_meses, 2)
            end;

  update public.fixed_assets
     set estado = case when coalesce(p_valor_venta,0) > 0 then 'vendido' else 'dado_de_baja' end,
         fecha_baja = v_fecha,
         motivo_baja = btrim(p_motivo),
         valor_venta = p_valor_venta,
         venta_treasury_account_id = case when coalesce(p_valor_venta,0) > 0
                                          then p_venta_treasury_account_id end,
         dep_acumulada_baja = v_acum,
         updated_at = now()
   where id = p_id;

  perform private.audit('team', v_actor, null, 'activo.baja', v_a.project_id,
    'fixed_asset', p_id, jsonb_build_object('codigo', v_a.codigo),
    jsonb_build_object('fecha', v_fecha, 'motivo', btrim(p_motivo),
                       'venta', p_valor_venta, 'acumulada', v_acum));
  return jsonb_build_object('ok', true, 'dep_acumulada', v_acum);
end;
$$;

grant execute on function public.admin_guardar_activo(uuid, uuid, uuid, text, text, text, text, date, date, numeric, numeric, int, uuid, uuid, uuid, text, text, text, text, text, date, uuid) to authenticated;
revoke execute on function public.admin_guardar_activo(uuid, uuid, uuid, text, text, text, text, date, date, numeric, numeric, int, uuid, uuid, uuid, text, text, text, text, text, date, uuid) from anon;
grant execute on function public.admin_dar_de_baja_activo(uuid, date, text, numeric, uuid) to authenticated;
revoke execute on function public.admin_dar_de_baja_activo(uuid, date, text, numeric, uuid) from anon;
