-- Crear la cuenta, y RECLAMAR la compra que ya se tenía.
--
-- El alta la dispara el propio cliente después de registrarse en Auth: la
-- sesión ya existe, así que la fila se crea a su nombre y no hace falta que
-- nadie del equipo intervenga. Es idempotente — si la primera llamada se
-- perdió, la siguiente la completa en vez de fallar.
create or replace function public.crear_mi_cuenta(
  p_full_name text,
  p_phone text default null,
  p_ci text default null,
  p_birth_date date default null,
  p_city text default null,
  p_como_nos_conocio text default null,
  p_marketing_opt_in boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_nombre text := btrim(coalesce(p_full_name, ''));
begin
  if v_uid is null then raise exception 'NO_SESSION'; end if;
  if v_nombre = '' then raise exception 'NAME_REQUIRED'; end if;

  -- El personal no se registra como cliente: se confundirían los dos mundos.
  if exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'CUENTA_DE_EQUIPO'
      using detail = 'Esta cuenta pertenece al equipo de Terrenalv.';
  end if;

  select u.email into v_email from auth.users u where u.id = v_uid;

  insert into public.customers as c
    (id, full_name, email, phone, ci, ci_normalized, birth_date, city,
     como_nos_conocio, marketing_opt_in, last_seen_at)
  values
    (v_uid, v_nombre, coalesce(v_email, ''),
     nullif(btrim(coalesce(p_phone, '')), ''),
     nullif(btrim(coalesce(p_ci, '')), ''),
     case when nullif(btrim(coalesce(p_ci, '')), '') is null
          then null else private.normalize_ci(p_ci) end,
     p_birth_date,
     nullif(btrim(coalesce(p_city, '')), ''),
     nullif(btrim(coalesce(p_como_nos_conocio, '')), ''),
     coalesce(p_marketing_opt_in, true), now())
  on conflict (id) do update
    set full_name = excluded.full_name,
        phone = coalesce(excluded.phone, c.phone),
        ci = coalesce(excluded.ci, c.ci),
        ci_normalized = coalesce(excluded.ci_normalized, c.ci_normalized),
        birth_date = coalesce(excluded.birth_date, c.birth_date),
        city = coalesce(excluded.city, c.city),
        como_nos_conocio = coalesce(excluded.como_nos_conocio, c.como_nos_conocio),
        marketing_opt_in = excluded.marketing_opt_in,
        last_seen_at = now(),
        updated_at = now();

  perform private.audit('guest', v_uid, v_nombre, 'cliente.registrado',
    null, 'customer', v_uid, null,
    jsonb_build_object('email', v_email, 'ciudad', p_city,
                       'como_nos_conocio', p_como_nos_conocio));

  return jsonb_build_object('ok', true, 'customer_id', v_uid);
end;
$$;

-- RECLAMAR UNA COMPRA.
--
-- El carnet solo NO alcanza: con el carnet de otro se verían sus compras, sus
-- pagos y su saldo. Hace falta el CÓDIGO DE SEGUIMIENTO, que es la prueba de
-- que la compra es suya — el mismo papel que hasta ayer era la única llave.
-- Se pide UNA vez; de ahí en adelante la compra vive en su cuenta.
create or replace function public.reclamar_mi_compra(p_tracking_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_res public.reservations%rowtype;
  v_cli public.customers%rowtype;
begin
  if v_uid is null then raise exception 'NO_SESSION'; end if;
  select * into v_cli from public.customers where id = v_uid;
  if not found then raise exception 'SIN_CUENTA'; end if;

  select * into v_res from public.reservations
   where tracking_code = upper(btrim(coalesce(p_tracking_code, '')));
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;

  if v_res.customer_id is not null and v_res.customer_id <> v_uid then
    raise exception 'YA_RECLAMADA'
      using detail = 'Esta compra ya está en la cuenta de otra persona. Si es un error, escribinos.';
  end if;

  update public.reservations set customer_id = v_uid, updated_at = now()
   where id = v_res.id;

  -- Si el cliente todavía no tenía carnet cargado, se toma el de la compra:
  -- viene del contrato, así que es el bueno.
  if v_cli.ci_normalized is null and v_res.buyer_ci is not null then
    update public.customers
       set ci = v_res.buyer_ci, ci_normalized = v_res.buyer_ci_normalized, updated_at = now()
     where id = v_uid;
  end if;

  perform private.audit('guest', v_uid, v_cli.full_name, 'compra.reclamada',
    v_res.project_id, 'reservation', v_res.id, null,
    jsonb_build_object('tracking_code', v_res.tracking_code));

  return jsonb_build_object('ok', true, 'tracking_code', v_res.tracking_code);
end;
$$;

grant execute on function public.crear_mi_cuenta(text, text, text, date, text, text, boolean) to authenticated;
grant execute on function public.reclamar_mi_compra(text) to authenticated;
