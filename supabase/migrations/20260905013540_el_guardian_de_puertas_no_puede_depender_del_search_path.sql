-- El guardián de puertas flojas no detectaba NADA, y probarlo en rojo con un
-- señuelo fue lo único que lo cantó.
--
-- La causa: `pg_policies.qual` se arma con pg_get_expr, que OMITE el esquema
-- cuando la función es visible en el search_path. Como la función declara
-- `SET search_path TO 'public','private'`, la misma política se lee
-- «private.is_team()» desde afuera y «is_team()» desde adentro — y el literal
-- nunca coincidía.
--
-- Es la misma piedra de siempre: un chequeo que compara TEXTO depende de cómo
-- se imprime ese texto. Ahora se compara contra los OIDs de las funciones,
-- leyendo el árbol de dependencias del catálogo, que no cambia de forma.

create or replace function private.puertas_flojas()
returns table(tabla text, politica text, puerta text)
language sql
stable
set search_path to 'public', 'private', 'pg_catalog'
as $$
  with techo(tabla) as (
    values ('hr_empleados'),('hr_planillas'),('hr_planilla_items'),('hr_documentos'),
           ('fixed_assets'),('asset_categories'),('land_parcels'),
           ('fiscal_comprobantes'),('fiscal_lineas'),('fiscal_exclusiones'),
           ('fiscal_facturas'),('fiscal_parametros'),
           ('journal_entries'),('journal_lines'),('expenses'),('fiscal_periods'),
           ('fondos_a_rendir'),('pagos_a_proveedor')
  ),
  flojas as (
    select p.oid as fn from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in ('is_team', 'is_accounting')
  ),
  recortes as (
    select p.oid as fn from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in ('nivel_de', 've_contabilidad')
  )
  select c.relname::text, pol.polname::text,
         pg_catalog.pg_get_expr(pol.polqual, pol.polrelid)
    from pg_catalog.pg_policy pol
    join pg_catalog.pg_class c on c.oid = pol.polrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join techo t on t.tabla = c.relname
   where n.nspname = 'public'
     and pol.polcmd in ('r', '*')      -- SELECT o ALL
     -- Se apoya en is_team()/is_accounting() y en NADA que recorte por sección.
     and exists (
       select 1 from pg_catalog.pg_depend d
        where d.classid = 'pg_policy'::regclass and d.objid = pol.oid
          and d.refclassid = 'pg_proc'::regclass
          and d.refobjid in (select fn from flojas))
     and not exists (
       select 1 from pg_catalog.pg_depend d
        where d.classid = 'pg_policy'::regclass and d.objid = pol.oid
          and d.refclassid = 'pg_proc'::regclass
          and d.refobjid in (select fn from recortes));
$$;
