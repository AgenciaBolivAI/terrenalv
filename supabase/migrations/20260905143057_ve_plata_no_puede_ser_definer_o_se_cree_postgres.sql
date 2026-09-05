-- `ve_plata()` había nacido SECURITY DEFINER, y eso la volvía inútil: adentro
-- de una función definer `current_user` es el DUEÑO (postgres), así que la
-- `ve_contabilidad()` que llama veía `current_user = postgres`, entraba por su
-- rama `current_user not in ('authenticated','anon')` y devolvía true. La
-- puerta quedaba abierta para todos.
--
-- Va STABLE y SIN definer, igual que `ve_contabilidad()`: `nivel_de()` e
-- `is_team()` ya son definer y saben leer `profiles` por su cuenta, así que no
-- hace falta subir privilegios acá — y así `current_user` sigue siendo el rol
-- real de la sesión.
create or replace function private.ve_plata()
returns boolean
language sql
stable
set search_path to 'public', 'private'
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
