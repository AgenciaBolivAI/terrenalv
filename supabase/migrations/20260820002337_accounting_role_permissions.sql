-- Quién puede tocar la plata: admin o contabilidad.
--
-- Se separa de is_admin() a propósito. Contabilidad cobra cuotas, carga
-- egresos y emite recibos; NO invita gente, no cambia precios ni reescribe la
-- configuracion. Si mañana esas dos cosas se juntaran, habria que volver a
-- hacer contador a alguien para que cobre una cuota.
create or replace function private.is_accounting()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active
      and p.role in ('admin', 'contabilidad')
  );
$fn$;

create or replace function private.assert_accounting()
returns uuid
language plpgsql
stable
set search_path = public, private
as $fn$
begin
  if not private.is_accounting() and not private.is_service() then
    raise exception 'NO_AUTORIZADO';
  end if;
  return auth.uid();
end;
$fn$;

revoke execute on function private.is_accounting(), private.assert_accounting() from public, anon;
grant execute on function private.is_accounting(), private.assert_accounting() to anon, authenticated;

-- Los egresos incluyen sueldos y comisiones: siguen fuera del alcance de
-- ventas, pero contabilidad tiene que verlos para poder cargarlos.
drop policy if exists expenses_admin_read on public.expenses;
create policy expenses_read on public.expenses
  for select to authenticated using (private.is_accounting());
