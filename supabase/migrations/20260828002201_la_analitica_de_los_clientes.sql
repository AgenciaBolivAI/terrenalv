-- LA ANALÍTICA DE LOS CLIENTES REGISTRADOS.
--
-- Cuántos se registraron, cuántos llegaron a comprar, quiénes cumplen años
-- este mes y a cuántos se les puede escribir. Cada cifra es una lista que se
-- puede abrir: un número sin manera de llegar a lo que cuenta no sirve.
create or replace view public.v_clientes_cuenta as
select
  c.id,
  c.full_name,
  c.email,
  c.phone,
  c.ci,
  c.city,
  c.birth_date,
  c.como_nos_conocio,
  c.marketing_opt_in,
  c.created_at,
  c.last_seen_at,
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
        extract(month from (now() at time zone 'America/La_Paz')))  as aniversario_este_mes
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

create or replace function public.an_clientes_resumen()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_por_mes jsonb;
  v_origen jsonb;
begin
  if not private.is_team() then raise exception 'FORBIDDEN'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('mes', mes, 'altas', altas) order by mes), '[]'::jsonb)
    into v_por_mes
  from (select mes_registro as mes, count(*) as altas
          from public.v_clientes_cuenta group by mes_registro) t;

  select coalesce(jsonb_agg(jsonb_build_object('origen', origen, 'cuantos', cuantos)
                            order by cuantos desc), '[]'::jsonb)
    into v_origen
  from (select coalesce(como_nos_conocio, 'sin decir') as origen, count(*) as cuantos
          from public.customers group by 1) t;

  return jsonb_build_object(
    'registrados',        (select count(*) from public.customers),
    'este_mes',           (select count(*) from public.customers
                            where created_at >= date_trunc('month', now() at time zone 'America/La_Paz')),
    'compradores',        (select count(*) from public.v_clientes_cuenta where es_comprador),
    'sin_comprar',        (select count(*) from public.v_clientes_cuenta where not es_comprador),
    'con_permiso_email',  (select count(*) from public.customers where marketing_opt_in),
    'cumplen_este_mes',   (select count(*) from public.v_clientes_cuenta where cumple_este_mes),
    'aniversario_mes',    (select count(*) from public.v_clientes_cuenta where aniversario_este_mes),
    'compras_vinculadas', (select count(*) from public.reservations where customer_id is not null),
    'compras_sin_cuenta', (select count(*) from public.reservations
                            where customer_id is null and status = 'confirmada'),
    'por_mes', v_por_mes,
    'como_nos_conocio', v_origen);
end;
$$;

revoke execute on function public.an_clientes_resumen() from anon;
grant execute on function public.an_clientes_resumen() to authenticated;
