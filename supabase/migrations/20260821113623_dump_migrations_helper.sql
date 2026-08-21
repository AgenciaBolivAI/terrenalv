-- Expone el SQL de las migraciones aplicadas, para que el repo pueda
-- sincronizarse con la base (scripts/dump-migrations.ts).
--
-- Existe porque varias migraciones se aplicaron directo contra la base y en el
-- repo quedaron sólo notas: el repo no podía reconstruir el esquema. Con esto,
-- volver a sincronizar es un comando en vez de copiar SQL a mano.
--
-- Sólo service_role. No expone nada secreto —el SQL del esquema ya está en el
-- repo público— pero tampoco tiene por qué leerlo un usuario de la aplicación.
create or replace function public._dump_migrations()
returns table (version text, name text, sql text)
language sql
security definer
set search_path = public, pg_temp
as $$
  select m.version, m.name, array_to_string(m.statements, E';\n\n')
    from supabase_migrations.schema_migrations m
   where m.statements is not null
   order by m.version
$$;

revoke execute on function public._dump_migrations() from public, anon, authenticated;
grant execute on function public._dump_migrations() to service_role;
