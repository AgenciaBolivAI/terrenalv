-- CONFIRMAR EL CORREO, SIN FRENAR NADA.
--
-- El alta ya no pasa por el correo: la cuenta se crea confirmada y la persona
-- entra en el acto. El precio de eso es que un error de tipeo deja una cuenta
-- viva sobre una dirección que nunca va a recibir nada — y todo el plan de
-- saludos de cumpleaños y aniversario depende de que esa dirección exista.
--
-- Así que se pide confirmar, pero NUNCA se bloquea: es un aviso en su panel
-- que puede ignorar todas las veces que quiera y seguir usando la cuenta.
-- `auth.users.email_confirmed_at` no sirve para saberlo (lo ponemos nosotros
-- al crear), así que la prueba de que la dirección es suya vive acá.
alter table public.customers
  add column if not exists email_verificado_at timestamptz,
  add column if not exists verify_token_hash text,
  add column if not exists verify_token_expira timestamptz;

-- Pedir el correo de confirmación. Devuelve el token EN CLARO una sola vez,
-- para que el servidor arme el enlace; en la tabla solo queda su hash.
create or replace function public.pedir_verificacion_de_correo()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_cli public.customers%rowtype;
  v_token text;
begin
  if v_uid is null then raise exception 'NO_SESSION'; end if;
  select * into v_cli from public.customers where id = v_uid;
  if not found then raise exception 'SIN_CUENTA'; end if;
  if v_cli.email_verificado_at is not null then
    return jsonb_build_object('ok', true, 'ya_verificado', true);
  end if;

  -- Un pedido cada 5 minutos: no se usa esto para bombardear una casilla.
  if v_cli.verify_token_expira is not null
     and v_cli.verify_token_expira > now() + interval '6 days 23 hours' then
    return jsonb_build_object('ok', false, 'error', 'ESPERA_UN_RATO');
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  update public.customers
     set verify_token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex'),
         verify_token_expira = now() + interval '7 days',
         updated_at = now()
   where id = v_uid;

  return jsonb_build_object('ok', true, 'token', v_token,
                            'email', v_cli.email, 'nombre', v_cli.full_name);
end;
$$;

-- Confirmar con el token. La llama el servidor cuando la persona abre el
-- enlace; por eso no mira auth.uid() — quien tiene el token es el dueño de
-- la casilla, que es justo lo que se quería probar.
create or replace function public.confirmar_correo_con_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_cli public.customers%rowtype;
begin
  if btrim(coalesce(p_token, '')) = '' then
    return jsonb_build_object('ok', false, 'error', 'TOKEN_INVALIDO');
  end if;

  select * into v_cli from public.customers
   where verify_token_hash = encode(extensions.digest(btrim(p_token), 'sha256'), 'hex')
     and verify_token_expira > now();
  if not found then
    return jsonb_build_object('ok', false, 'error', 'TOKEN_INVALIDO');
  end if;

  update public.customers
     set email_verificado_at = now(),
         verify_token_hash = null, verify_token_expira = null,
         updated_at = now()
   where id = v_cli.id;

  perform private.audit('guest', v_cli.id, v_cli.full_name, 'cliente.correo_verificado',
    null, 'customer', v_cli.id, null, jsonb_build_object('email', v_cli.email));

  return jsonb_build_object('ok', true, 'email', v_cli.email);
end;
$$;

revoke execute on function public.pedir_verificacion_de_correo() from anon;
grant execute on function public.pedir_verificacion_de_correo() to authenticated;
revoke execute on function public.confirmar_correo_con_token(text) from anon, authenticated, public;
grant execute on function public.confirmar_correo_con_token(text) to service_role;

-- El padrón dice quién tiene la dirección probada: sin eso, «con permiso de
-- correo» cuenta gente a la que nunca le va a llegar nada.
create or replace view public.v_clientes_cuenta as
select
  c.id, c.full_name, c.email, c.phone, c.ci, c.city, c.birth_date,
  c.como_nos_conocio, c.marketing_opt_in, c.created_at, c.last_seen_at,
  (c.created_at at time zone 'America/La_Paz')::date               as fecha_registro,
  to_char(c.created_at at time zone 'America/La_Paz', 'YYYY-MM')   as mes_registro,
  coalesce(v.compras, 0)                                          as compras,
  coalesce(v.invertido, 0)                                        as invertido,
  coalesce(v.saldo, 0)                                            as saldo,
  (coalesce(v.compras, 0) > 0)                                    as es_comprador,
  (c.birth_date is not null
    and extract(month from c.birth_date) =
        extract(month from (now() at time zone 'America/La_Paz')))  as cumple_este_mes,
  v.primera_compra,
  (v.primera_compra is not null
    and extract(month from v.primera_compra) =
        extract(month from (now() at time zone 'America/La_Paz')))  as aniversario_este_mes,
  (c.email_verificado_at is not null)                             as correo_verificado
from public.customers c
left join lateral (
  select count(*) filter (where r.status = 'confirmada')          as compras,
         sum(vv.pagado_total) filter (where r.status = 'confirmada') as invertido,
         sum(vv.saldo) filter (where r.status = 'confirmada')      as saldo,
         min((r.confirmed_at at time zone 'America/La_Paz')::date) as primera_compra
    from public.reservations r
    left join public.v_ventas vv on vv.reservation_id = r.id
   where r.customer_id = c.id
) v on true;

alter view public.v_clientes_cuenta set (security_invoker = true);
grant select on public.v_clientes_cuenta to authenticated;
