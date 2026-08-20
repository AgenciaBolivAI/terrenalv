-- Quién puede tocar la plata: admin o contabilidad.
--
-- Se separa de is_admin() a propósito. Contabilidad cobra cuotas, carga egresos
-- y emite recibos; NO invita gente, no cambia precios ni reescribe la
-- configuración. Si esas dos cosas se juntaran, habría que volver a hacer
-- administrador a alguien solo para que pueda cobrar una cuota, que es
-- exactamente el problema que este rol viene a sacar.
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

-- Los cinco RPC de contabilidad pasan de assert_admin() a assert_accounting().
-- Los de venta (mark_sold_offline, admin_reserve_offline, admin_set_lots_blocked,
-- set_team_member, update_setting) NO cambian: siguen siendo de administrador.
-- El cuerpo completo de las funciones está en 20260818000002_accounting_rpcs.sql,
-- que ya quedó actualizado con el nuevo guard.
