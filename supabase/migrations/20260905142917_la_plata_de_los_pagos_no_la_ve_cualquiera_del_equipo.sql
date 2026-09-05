-- «En Cuentas no quiero que tengan acceso a información de pagos ni costos».
--
-- Esconder los importes en la pantalla no alcanza: `payments`, `installments`
-- e `installment_plans` estaban abiertas a CUALQUIERA del equipo
-- (`private.is_team()`), sin mirar sus permisos. Alguien con acceso sólo a
-- Cuentas —clientes=no, ventas=no, planes=no, contabilidad=no— leía igual los
-- 59 pagos por REST. Es el mismo agujero que la auditoría del 5/9 cerró para
-- el libro: el permiso decía «no» y la RLS decía «sí».
--
-- La puerta nueva es generosa a propósito: la abre CUALQUIER sección que
-- legítimamente trabaja con plata. Sólo se queda afuera quien no tiene ninguna
-- —hoy, el perfil que sólo mira Cuentas—. Así el mostrador sigue cobrando y
-- confirmando reservas como hasta ahora.
create or replace function private.ve_plata()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
  select private.is_team() and (
       private.nivel_de((select auth.uid()), 'ventas')         <> 'no'
    or private.nivel_de((select auth.uid()), 'reservas')       <> 'no'
    or private.nivel_de((select auth.uid()), 'planes')         <> 'no'
    or private.nivel_de((select auth.uid()), 'clientes')       <> 'no'
    or private.nivel_de((select auth.uid()), 'comisiones')     <> 'no'
    or private.nivel_de((select auth.uid()), 'financiamiento') <> 'no'
    or private.nivel_de((select auth.uid()), 'mercado')        <> 'no'
    or private.nivel_de((select auth.uid()), 'traspasos')      <> 'no'
    or private.ve_contabilidad()
  );
$function$;

drop policy if exists payments_team_read on public.payments;
create policy payments_team_read on public.payments
  for select to authenticated using (private.ve_plata());

drop policy if exists installments_team_read on public.installments;
create policy installments_team_read on public.installments
  for select to authenticated using (private.ve_plata());

drop policy if exists plans_team_read on public.installment_plans;
create policy plans_team_read on public.installment_plans
  for select to authenticated using (private.ve_plata());
