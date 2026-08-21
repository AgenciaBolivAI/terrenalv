-- Extensions, schemas, and shared trigger helpers.
-- `private` schema is never exposed through PostgREST (only `public` is in the exposed list).

create extension if not exists pgcrypto with schema extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists pg_cron;
create extension if not exists pg_net;

create schema if not exists private;

-- anon/authenticated may EXECUTE specifically-granted helper functions (needed inside RLS
-- policies) but can never touch private tables: no table grants exist and defaults revoke them.
grant usage on schema private to anon, authenticated;
alter default privileges in schema private revoke all on tables from anon, authenticated;
alter default privileges in schema private revoke all on functions from public, anon, authenticated;

create or replace function private.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
