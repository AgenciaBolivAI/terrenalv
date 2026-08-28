-- EL LIBRO ES UNO SOLO.
--
-- El correlativo del comprobante venía por urbanización, así que había DOS
-- ING-0001 y DOS TRA-0001 —uno en Prados del Sur III y otro en Alto Prados,
-- uno en Prados del Sur II y otro en el V—. Citar «el comprobante ING-0001»
-- no identificaba nada.
--
-- No es así como se lleva. La contabilidad es una: un gasto se asigna a la
-- urbanización que corresponda, pero el número de comprobante sigue el orden
-- del LIBRO. Si el 1 salió para Prados del Sur, el 2 puede ser para Prados
-- del Sur II y el 3 volver al primero: la urbanización es una dimensión del
-- asiento, no un libro aparte.
--
-- Además el número se toma bajo un lock por tipo de comprobante: con el
-- correlativo global, dos personas cargando a la vez en urbanizaciones
-- distintas ya no son un caso raro, y `max + 1` sin lock les da el mismo
-- número a las dos.

-- ---------------------------------------------------------------------------
-- Los comprobantes manuales
-- ---------------------------------------------------------------------------
create or replace function private.next_voucher_number(p_kind voucher_kind)
returns text
language plpgsql
set search_path to 'public', 'private'
as $$
declare v_n int;
begin
  -- Un lock por tipo, no por urbanización: el correlativo es del libro.
  perform pg_advisory_xact_lock(hashtext('comprobante:' || p_kind::text));
  select coalesce(max(substring(number from '[0-9]+$')::int), 0) + 1
    into v_n
    from public.journal_entries
   where kind = p_kind;
  return upper(substr(p_kind::text, 1, 3)) || '-' || lpad(v_n::text, 4, '0');
end;
$$;

-- Renumerar lo que ya está, por fecha del asiento. Los anulados conservan su
-- número: un comprobante anulado sigue ocupando su lugar en el libro, si no
-- el correlativo tendría huecos.
with ordenados as (
  select id, kind,
         row_number() over (partition by kind order by entry_date, created_at, id) as n
    from public.journal_entries
)
update public.journal_entries je
   set number = upper(substr(o.kind::text, 1, 3)) || '-' || lpad(o.n::text, 4, '0'),
       updated_at = now()
  from ordenados o
 where o.id = je.id
   and je.number is distinct from (upper(substr(o.kind::text, 1, 3)) || '-' || lpad(o.n::text, 4, '0'));

-- El número es único en el LIBRO, no dentro de la urbanización.
alter table public.journal_entries drop constraint if exists journal_entries_project_id_number_key;
create unique index if not exists journal_entries_number_uidx
  on public.journal_entries (number);

-- `admin_save_voucher` pedía el número por urbanización. Se lo parcha en el
-- lugar exacto para no reescribir una función de 150 líneas que ya tiene sus
-- propios guardianes.
do $$
declare v_def text; v_ancla text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_save_voucher';

  v_ancla := 'private.next_voucher_number(p_project_id, p_kind)';
  if position(v_ancla in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA'
      using detail = 'admin_save_voucher ya no pide el número como se esperaba.';
  end if;
  execute replace(v_def, v_ancla, 'private.next_voucher_number(p_kind)');
end $$;

drop function if exists private.next_voucher_number(uuid, voucher_kind);

-- ---------------------------------------------------------------------------
-- Los comprobantes de egreso
-- ---------------------------------------------------------------------------
drop index if exists public.expenses_numero_uidx;
create unique index if not exists expenses_numero_uidx
  on public.expenses (numero) where numero is not null;

drop function if exists private.next_expense_number(uuid);

create or replace function private.next_expense_number()
returns text
language plpgsql
set search_path to 'public', 'private'
as $$
declare v_n int;
begin
  perform pg_advisory_xact_lock(hashtext('comprobante:egreso'));
  select coalesce(max(substring(numero from '[0-9]+$')::int), 0) + 1
    into v_n
    from public.expenses;
  return 'C/E-' || lpad(v_n::text, 4, '0');
end;
$$;

create or replace function private.tg_expense_numero()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
begin
  if new.numero is null then
    new.numero := private.next_expense_number();
  end if;
  return new;
end;
$$;

-- Renumerar los egresos que ya estuvieran cargados, por fecha, en un solo
-- corrido para todas las urbanizaciones.
with ordenados as (
  select id, row_number() over (order by incurred_on, created_at, id) as n
    from public.expenses
)
update public.expenses e
   set numero = 'C/E-' || lpad(o.n::text, 4, '0')
  from ordenados o
 where o.id = e.id
   and e.numero is distinct from ('C/E-' || lpad(o.n::text, 4, '0'));

comment on column public.expenses.numero is
  'Correlativo del comprobante de egreso, único en TODO el libro (C/E-0001). '
  'No se reinicia por urbanización: la contabilidad es una sola y el número '
  'sigue el orden del libro, sea cual sea la urbanización a la que carga.';
