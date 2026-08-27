-- El permiso por persona también ABRE, no solo recorta.
--
-- El dueño le dio a Beymar (rol ventas) contabilidad = «edita» para probar el
-- sistema, y aun así no podía crear un plan de pago: la página y la RLS solo
-- miraban el ROL. El modelo honesto es el que ya usa mi_acceso(): el rol pone
-- el punto de partida y el permiso explícito por persona manda — para abrir y
-- para cerrar.
--
-- is_accounting() ahora acepta también a quien tiene el permiso explícito
-- contabilidad = 'edita' en su ficha. Un solo lookup a profiles, igual que
-- antes. Los recortes de escritura por sección siguen en manos de los
-- candados tg_solo_lectura, que ya vigilan tabla por tabla.
create or replace function private.is_accounting()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active
      and (p.role in ('admin', 'contabilidad')
           or p.permisos->>'contabilidad' = 'edita')
  );
$$;
