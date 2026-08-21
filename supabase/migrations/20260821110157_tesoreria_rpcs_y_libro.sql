-- Alta de cuentas de tesorería, terceros y transferencias entre cuentas.

create or replace function public.admin_upsert_treasury(
  p_name text,
  p_kind public.treasury_kind default 'banco',
  p_bank_name text default null,
  p_account_number text default null,
  p_currency char(3) default 'BOB',
  p_opening_balance numeric default 0,
  p_opening_date date default null,
  p_id uuid default null,
  p_is_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid;
  v_id uuid;
  v_code text;
  v_n int;
begin
  v_actor := private.assert_accounting();
  if btrim(coalesce(p_name, '')) = '' then raise exception 'NAME_REQUIRED'; end if;

  if p_id is not null then
    update public.treasury_accounts
       set name = btrim(p_name), kind = p_kind, bank_name = nullif(btrim(coalesce(p_bank_name,'')),''),
           account_number = nullif(btrim(coalesce(p_account_number,'')),''),
           currency = coalesce(p_currency,'BOB'), is_active = coalesce(p_is_active, true),
           updated_at = now()
     where id = p_id
    returning id, account_code into v_id, v_code;
    if v_id is null then raise exception 'TREASURY_NOT_FOUND'; end if;

    update public.chart_of_accounts set name = btrim(p_name), updated_at = now() where code = v_code;
    return jsonb_build_object('id', v_id, 'account_code', v_code);
  end if;

  -- Cada cuenta nueva recibe su propia cuenta contable bajo 1111: así el mayor
  -- muestra el saldo de CADA banco y CADA caja por separado, que es lo que se
  -- compara contra un extracto.
  select count(*) + 1 into v_n from public.treasury_accounts;
  v_code := '1111.' || lpad(v_n::text, 2, '0');
  while exists (select 1 from public.chart_of_accounts where code = v_code) loop
    v_n := v_n + 1;
    v_code := '1111.' || lpad(v_n::text, 2, '0');
  end loop;

  insert into public.chart_of_accounts (code, name, kind, sort_order, parent_code, is_system)
  values (v_code, btrim(p_name), 'activo',
          (select coalesce(max(sort_order), 0) + 1 from public.chart_of_accounts where code like '1111%'),
          '1111', true);

  insert into public.treasury_accounts
    (kind, name, bank_name, account_number, currency, account_code,
     opening_balance, opening_date, created_by)
  values
    (p_kind, btrim(p_name), nullif(btrim(coalesce(p_bank_name,'')),''),
     nullif(btrim(coalesce(p_account_number,'')),''), coalesce(p_currency,'BOB'), v_code,
     coalesce(p_opening_balance, 0), p_opening_date, v_actor)
  returning id into v_id;

  perform private.audit('team', v_actor, null, 'treasury.created', null, 'treasury', v_id,
    null, jsonb_build_object('nombre', btrim(p_name), 'cuenta', v_code, 'tipo', p_kind));

  return jsonb_build_object('id', v_id, 'account_code', v_code);
end;
$fn$;

create or replace function public.admin_upsert_contact(
  p_name text,
  p_kind public.contact_kind default 'proveedor',
  p_tax_id text default null,
  p_phone text default null,
  p_email text default null,
  p_address text default null,
  p_notes text default null,
  p_id uuid default null,
  p_is_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare v_actor uuid; v_id uuid;
begin
  v_actor := private.assert_accounting();
  if btrim(coalesce(p_name, '')) = '' then raise exception 'NAME_REQUIRED'; end if;

  if p_id is null then
    insert into public.contacts (kind, name, tax_id, phone, email, address, notes, created_by)
    values (p_kind, btrim(p_name), nullif(btrim(coalesce(p_tax_id,'')),''),
            nullif(btrim(coalesce(p_phone,'')),''), nullif(btrim(coalesce(p_email,'')),''),
            nullif(btrim(coalesce(p_address,'')),''), nullif(btrim(coalesce(p_notes,'')),''), v_actor)
    returning id into v_id;
  else
    update public.contacts
       set kind = p_kind, name = btrim(p_name), tax_id = nullif(btrim(coalesce(p_tax_id,'')),''),
           phone = nullif(btrim(coalesce(p_phone,'')),''), email = nullif(btrim(coalesce(p_email,'')),''),
           address = nullif(btrim(coalesce(p_address,'')),''), notes = nullif(btrim(coalesce(p_notes,'')),''),
           is_active = coalesce(p_is_active, true), updated_at = now()
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'CONTACT_NOT_FOUND'; end if;
  end if;

  return jsonb_build_object('id', v_id);
end;
$fn$;

-- Transferencia entre cuentas propias: no es ingreso ni egreso, es la misma
-- plata cambiando de lugar. Se asienta como comprobante para que quede en el
-- libro y no aparezca como una venta ni como un gasto.
create or replace function public.admin_transfer_funds(
  p_project_id uuid,
  p_from uuid,
  p_to uuid,
  p_amount numeric,
  p_date date default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid; v_from public.treasury_accounts%rowtype; v_to public.treasury_accounts%rowtype;
  v_id uuid; v_number text; v_date date;
begin
  v_actor := private.assert_accounting();
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_from = p_to then raise exception 'MISMA_CUENTA'; end if;

  select * into v_from from public.treasury_accounts where id = p_from;
  select * into v_to   from public.treasury_accounts where id = p_to;
  if v_from.id is null or v_to.id is null then raise exception 'TREASURY_NOT_FOUND'; end if;
  -- Transferir entre monedas distintas necesita un tipo de cambio y genera
  -- diferencia de cambio: se frena antes que registrar algo que no cuadra.
  if v_from.currency <> v_to.currency then raise exception 'MONEDAS_DISTINTAS'; end if;

  v_date := coalesce(p_date, current_date);
  perform private.assert_periodo_abierto(p_project_id, v_date);

  v_number := private.next_voucher_number(p_project_id, 'traspaso');
  insert into public.journal_entries
    (project_id, number, kind, entry_date, glosa, status, is_automatic, created_by, posted_by, posted_at)
  values
    (p_project_id, v_number, 'traspaso', v_date,
     format('Transferencia %s → %s%s', v_from.name, v_to.name,
            coalesce(' — ' || nullif(btrim(p_note), ''), '')),
     'registrado', true, v_actor, v_actor, now())
  returning id into v_id;

  insert into public.journal_lines (entry_id, account_code, debe, haber, sort_order) values
    (v_id, v_to.account_code,   round(p_amount, 2), 0, 1),
    (v_id, v_from.account_code, 0, round(p_amount, 2), 2);

  perform private.audit('team', v_actor, null, 'treasury.transfer', p_project_id,
    'journal_entry', v_id, null,
    jsonb_build_object('desde', v_from.name, 'hasta', v_to.name, 'monto', p_amount));

  return jsonb_build_object('entry_id', v_id, 'number', v_number);
end;
$fn$;

revoke execute on function
  public.admin_upsert_treasury(text, public.treasury_kind, text, text, char, numeric, date, uuid, boolean),
  public.admin_upsert_contact(text, public.contact_kind, text, text, text, text, text, uuid, boolean),
  public.admin_transfer_funds(uuid, uuid, uuid, numeric, date, text)
from public, anon;

grant execute on function
  public.admin_upsert_treasury(text, public.treasury_kind, text, text, char, numeric, date, uuid, boolean),
  public.admin_upsert_contact(text, public.contact_kind, text, text, text, text, text, uuid, boolean),
  public.admin_transfer_funds(uuid, uuid, uuid, numeric, date, text)
to authenticated, service_role;
