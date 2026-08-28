-- 1) ROMPÍ EL MERCADO. Lo encontró el ataque, y era total.
--
-- El candado de solo-lectura (private.tg_solo_lectura) es el sistema de
-- permisos DEL PERSONAL: mira private.nivel_de(), que exige fila en `profiles`.
-- Solo perdonaba cuando `auth.uid() is null` — y así funcionaba el mercado
-- antes, porque el vendedor publicaba SIN sesión.
--
-- Al exigir cuenta para publicar, las dos condiciones quedaron excluyentes:
-- el candado solo deja pasar a quien NO tiene sesión, y la función solo deja
-- pasar a quien SÍ la tiene. Ningún comprador cabía en el medio. Resultado:
-- publicar, repreciar y retirar reventaban con PERMISO_SOLO_LECTURA, y la
-- pantalla se lo tragaba como «intenta de nuevo en un momento». El negocio de
-- la comisión del 20 % quedó cerrado para todos los clientes.
--
-- El candado no debe pronunciarse sobre un cliente: no es de su mundo. A quién
-- le pertenece cada compra ya lo decide la función (customer_id = auth.uid()),
-- y las tablas no tienen ninguna política de escritura para `authenticated`,
-- así que el único camino sigue siendo la RPC.
create or replace function private.tg_solo_lectura()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
begin
  -- Sin sesión (seed, service role, jobs) no hay a quién restringir.
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  -- Un CLIENTE no es personal: este candado reparte permisos del equipo y no
  -- tiene nada que decirle. Su autorización la hace la función que lo llamó.
  if not exists (select 1 from public.profiles p where p.id = auth.uid()) then
    return coalesce(new, old);
  end if;
  if private.nivel_de(auth.uid(), tg_argv[0]) <> 'edita' then
    raise exception 'PERMISO_SOLO_LECTURA'
      using detail = format('tu acceso a %s es de solo lectura', tg_argv[0]);
  end if;
  return coalesce(new, old);
end;
$$;

-- 2) NADIE VACÍA UNA TABLA DESDE EL NAVEGADOR.
--
-- Supabase concede por defecto todos los privilegios a `anon` y `authenticated`
-- sobre el esquema public. Para INSERT/UPDATE/DELETE eso lo tapa la RLS, pero
-- **TRUNCATE NO PASA POR RLS**: cualquiera con sesión —un comprador recién
-- registrado— podía vaciar hr_empleados, fixed_assets, commission_scales o
-- customers de un tirón. Lo demostró el ataque contra una tabla real.
--
-- TRUNCATE no se usa jamás desde el cliente. Se quita de todo el esquema, para
-- las dos roles, y se deja quitado para lo que se cree en adelante.
do $$
declare r record;
begin
  for r in
    select c.oid::regclass as t
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('revoke truncate, trigger, references on %s from anon, authenticated', r.t);
  end loop;
end $$;

alter default privileges in schema public
  revoke truncate, trigger, references on tables from anon, authenticated;

-- 3) `customers` la escribe SOLO su función. El alta pasa por crear_mi_cuenta
--    (SECURITY DEFINER), así que el rol del navegador no necesita INSERT ni
--    DELETE: dejarlos abiertos es dejar una puerta que nadie usa.
revoke insert, delete on public.customers from anon, authenticated;
revoke all on public.customers from anon;
grant select on public.customers to authenticated;
grant update (full_name, phone, ci, birth_date, city, como_nos_conocio, marketing_opt_in)
  on public.customers to authenticated;
