-- Comprobantes manuales: guardar, registrar y anular.
--
-- Un comprobante se guarda en borrador cuantas veces haga falta, pero al
-- REGISTRARLO se comprueba que cuadre. Validar recién al registrar y no en cada
-- línea es lo que deja escribir un asiento de arriba hacia abajo sin pelearse
-- con el formulario a mitad de camino.

-- ¿La fecha cae en una gestión ya cerrada? Nada entra a un período cerrado:
-- ahí está la razón de cerrarlo.
create or replace function private.assert_periodo_abierto(p_project_id uuid, p_fecha date)
returns void
language plpgsql
stable
set search_path = public, private
as $fn$
begin
  if exists (
    select 1 from public.fiscal_periods
     where project_id = p_project_id and status = 'cerrado'
       and p_fecha between starts_on and ends_on
  ) then
    raise exception 'PERIODO_CERRADO';
  end if;
end;
$fn$;

-- Numeración correlativa por proyecto y tipo: ING-0001, EGR-0001, TRA-0001.
create or replace function private.next_voucher_number(p_project_id uuid, p_kind public.voucher_kind)
returns text
language sql
stable
set search_path = public, private
as $fn$
  select upper(substr(p_kind::text, 1, 3)) || '-' ||
         lpad((coalesce(max(substring(number from '[0-9]+$')::int), 0) + 1)::text, 4, '0')
    from public.journal_entries
   where project_id = p_project_id and kind = p_kind;
$fn$;

create or replace function public.admin_save_voucher(
  p_project_id uuid,
  p_entry_date date,
  p_kind public.voucher_kind,
  p_glosa text,
  p_lines jsonb,
  p_entry_id uuid default null,
  p_post boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid;
  v_id uuid;
  v_number text;
  v_debe numeric(14,2) := 0;
  v_haber numeric(14,2) := 0;
  v_n int := 0;
  v_line jsonb;
  v_status public.voucher_status;
begin
  v_actor := private.assert_accounting();

  if btrim(coalesce(p_glosa, '')) = '' then raise exception 'GLOSA_REQUIRED'; end if;
  if p_entry_date is null then raise exception 'DATE_REQUIRED'; end if;
  perform private.assert_periodo_abierto(p_project_id, p_entry_date);

  -- Cuadre y validez de cada línea, antes de tocar nada.
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_n := v_n + 1;
    if not exists (select 1 from public.chart_of_accounts
                    where code = v_line->>'account_code' and is_active) then
      raise exception 'CUENTA_INVALIDA';
    end if;
    v_debe  := v_debe  + coalesce((v_line->>'debe')::numeric, 0);
    v_haber := v_haber + coalesce((v_line->>'haber')::numeric, 0);
  end loop;

  if p_post then
    if v_n < 2 then raise exception 'MINIMO_DOS_LINEAS'; end if;
    if v_debe <= 0 then raise exception 'IMPORTE_CERO'; end if;
    -- Un centavo de diferencia es un asiento mal hecho, no un redondeo.
    if round(v_debe, 2) <> round(v_haber, 2) then raise exception 'NO_CUADRA'; end if;
  end if;

  v_status := case when p_post then 'registrado'::public.voucher_status
                   else 'borrador'::public.voucher_status end;

  if p_entry_id is null then
    v_number := private.next_voucher_number(p_project_id, p_kind);
    insert into public.journal_entries
      (project_id, number, kind, entry_date, glosa, status, created_by,
       posted_by, posted_at)
    values
      (p_project_id, v_number, p_kind, p_entry_date, btrim(p_glosa), v_status, v_actor,
       case when p_post then v_actor end, case when p_post then now() end)
    returning id into v_id;
  else
    -- Un comprobante ya registrado o anulado no se edita: se anula y se hace
    -- otro, que es como se corrige un asiento sin borrar historia.
    select status into v_status from public.journal_entries where id = p_entry_id;
    if v_status is null then raise exception 'VOUCHER_NOT_FOUND'; end if;
    if v_status <> 'borrador' then raise exception 'VOUCHER_NOT_EDITABLE'; end if;

    update public.journal_entries
       set entry_date = p_entry_date, kind = p_kind, glosa = btrim(p_glosa),
           status = case when p_post then 'registrado' else 'borrador' end,
           posted_by = case when p_post then v_actor else null end,
           posted_at = case when p_post then now() else null end,
           updated_at = now()
     where id = p_entry_id
    returning id, number into v_id, v_number;

    delete from public.journal_lines where entry_id = v_id;
  end if;

  v_n := 0;
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_n := v_n + 1;
    insert into public.journal_lines (entry_id, account_code, debe, haber, glosa, sort_order)
    values (v_id, v_line->>'account_code',
            round(coalesce((v_line->>'debe')::numeric, 0), 2),
            round(coalesce((v_line->>'haber')::numeric, 0), 2),
            nullif(btrim(coalesce(v_line->>'glosa', '')), ''), v_n);
  end loop;

  perform private.audit('team', v_actor, null,
    case when p_post then 'voucher.posted' else 'voucher.saved' end, p_project_id,
    'journal_entry', v_id, null,
    jsonb_build_object('numero', v_number, 'fecha', p_entry_date,
                       'debe', v_debe, 'haber', v_haber, 'lineas', v_n));

  return jsonb_build_object('entry_id', v_id, 'number', v_number,
                            'debe', v_debe, 'haber', v_haber);
end;
$fn$;

create or replace function public.admin_void_voucher(p_entry_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid;
  v_e public.journal_entries%rowtype;
begin
  v_actor := private.assert_accounting();
  if btrim(coalesce(p_note, '')) = '' then raise exception 'NOTE_REQUIRED'; end if;

  select * into v_e from public.journal_entries where id = p_entry_id;
  if v_e.id is null then raise exception 'VOUCHER_NOT_FOUND'; end if;
  if v_e.status = 'anulado' then raise exception 'VOUCHER_ALREADY_VOID'; end if;
  if v_e.is_automatic then raise exception 'VOUCHER_AUTOMATIC'; end if;
  perform private.assert_periodo_abierto(v_e.project_id, v_e.entry_date);

  update public.journal_entries
     set status = 'anulado', voided_note = p_note, updated_at = now()
   where id = p_entry_id;

  perform private.audit('team', v_actor, null, 'voucher.voided', v_e.project_id,
    'journal_entry', p_entry_id,
    jsonb_build_object('status', v_e.status), jsonb_build_object('nota', p_note));

  return jsonb_build_object('ok', true);
end;
$fn$;

revoke execute on function
  public.admin_save_voucher(uuid, date, public.voucher_kind, text, jsonb, uuid, boolean),
  public.admin_void_voucher(uuid, text)
from public, anon;

grant execute on function
  public.admin_save_voucher(uuid, date, public.voucher_kind, text, jsonb, uuid, boolean),
  public.admin_void_voucher(uuid, text)
to authenticated, service_role;
