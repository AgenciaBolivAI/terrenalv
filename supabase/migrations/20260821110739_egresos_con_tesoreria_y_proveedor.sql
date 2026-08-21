-- El egreso ahora dice de qué cuenta salió y a qué proveedor del directorio fue.
--
-- Se reemplaza la función en vez de agregarle parámetros con default: dos
-- sobrecargas con el mismo nombre dejan a PostgREST sin saber cuál llamar.
drop function if exists public.admin_record_expense(
  uuid, date, public.expense_category, text, numeric, char, text, text, text);

create function public.admin_record_expense(
  p_project_id uuid,
  p_incurred_on date,
  p_category public.expense_category,
  p_description text,
  p_amount numeric,
  p_currency char(3) default null,
  p_supplier text default null,
  p_receipt_storage_path text default null,
  p_note text default null,
  p_treasury_account_id uuid default null,
  p_contact_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid;
  v_project public.projects%rowtype;
  v_cur char(3);
  v_rate numeric(10,4);
  v_bob numeric(12,2);
  v_id uuid;
  v_supplier text;
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
     treasury_account_id, contact_id)
  values
    (p_project_id, p_incurred_on, p_category, btrim(p_description),
     v_supplier, p_amount, v_cur, v_bob, v_rate,
     p_receipt_storage_path, nullif(btrim(coalesce(p_note, '')), ''), v_actor,
     p_treasury_account_id, p_contact_id)
  returning id into v_id;

  perform private.audit('team', v_actor, null, 'expense.created', p_project_id,
    'expense', v_id,
    null, jsonb_build_object('monto', p_amount, 'moneda', v_cur, 'categoria', p_category,
                             'fecha', p_incurred_on, 'detalle', btrim(p_description),
                             'proveedor', v_supplier));

  return jsonb_build_object('expense_id', v_id, 'amount_bob', v_bob);
end;
$fn$;

revoke execute on function public.admin_record_expense(
  uuid, date, public.expense_category, text, numeric, char, text, text, text, uuid, uuid)
from public, anon;
grant execute on function public.admin_record_expense(
  uuid, date, public.expense_category, text, numeric, char, text, text, text, uuid, uuid)
to authenticated, service_role;
