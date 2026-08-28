-- ALTA DE CLIENTE SIN VUELTA POR EL CORREO.
--
-- El dueño lo pidió así: sin confirmación. La cuenta se crea con el correo ya
-- confirmado desde el servidor —igual que las del equipo— y la persona entra
-- en el acto. `mailer_autoconfirm` sigue en false en el panel de Supabase (esa
-- palanca necesita un token de administración que no vive en el repo), pero no
-- hace falta tocarla: creando el usuario desde el servicio, GoTrue no manda
-- ningún correo de confirmación y la sesión sale al toque.
--
-- Esta función NO la puede llamar el navegador: es solo para `service_role`,
-- desde /api/cuenta/registrar. El alta que sí llama el cliente logueado sigue
-- siendo crear_mi_cuenta.
alter table public.customers add column if not exists ip_hash text;
create index if not exists customers_ip_idx on public.customers (ip_hash, created_at);

create or replace function public.alta_de_cliente(
  p_uid uuid,
  p_full_name text,
  p_email text,
  p_phone text default null,
  p_ci text default null,
  p_birth_date date default null,
  p_city text default null,
  p_como_nos_conocio text default null,
  p_marketing_opt_in boolean default true,
  p_ip_hash text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_nombre text := btrim(coalesce(p_full_name, ''));
  v_recientes int;
begin
  if p_uid is null then raise exception 'UID_REQUERIDO'; end if;
  if v_nombre = '' then raise exception 'NAME_REQUIRED'; end if;

  -- Nunca un miembro del equipo por esta puerta.
  if exists (select 1 from public.profiles p where p.id = p_uid) then
    raise exception 'CUENTA_DE_EQUIPO';
  end if;

  -- Un freno para que nadie llene el padrón desde una sola conexión. No es el
  -- único: la ruta también valida, pero el freno tiene que vivir donde no se
  -- pueda saltear.
  if p_ip_hash is not null then
    select count(*) into v_recientes from public.customers
     where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
    if v_recientes >= 5 then
      raise exception 'DEMASIADAS_CUENTAS'
        using detail = 'Se crearon varias cuentas desde esta conexión. Probá más tarde.';
    end if;
  end if;

  insert into public.customers as c
    (id, full_name, email, phone, ci, ci_normalized, birth_date, city,
     como_nos_conocio, marketing_opt_in, ip_hash, last_seen_at)
  values
    (p_uid, v_nombre, lower(btrim(coalesce(p_email, ''))),
     nullif(btrim(coalesce(p_phone, '')), ''),
     nullif(btrim(coalesce(p_ci, '')), ''),
     case when nullif(btrim(coalesce(p_ci, '')), '') is null
          then null else private.normalize_ci(p_ci) end,
     p_birth_date,
     nullif(btrim(coalesce(p_city, '')), ''),
     nullif(btrim(coalesce(p_como_nos_conocio, '')), ''),
     coalesce(p_marketing_opt_in, true), p_ip_hash, now())
  on conflict (id) do update
    set full_name = excluded.full_name, last_seen_at = now(), updated_at = now();

  perform private.audit('guest', p_uid, v_nombre, 'cliente.registrado',
    null, 'customer', p_uid, null,
    jsonb_build_object('email', p_email, 'ciudad', p_city,
                       'como_nos_conocio', p_como_nos_conocio, 'sin_confirmacion', true));

  return jsonb_build_object('ok', true, 'customer_id', p_uid);
end;
$$;

revoke execute on function public.alta_de_cliente(uuid, text, text, text, text, date, text, text, boolean, text)
  from anon, authenticated, public;
grant execute on function public.alta_de_cliente(uuid, text, text, text, text, date, text, text, boolean, text)
  to service_role;
