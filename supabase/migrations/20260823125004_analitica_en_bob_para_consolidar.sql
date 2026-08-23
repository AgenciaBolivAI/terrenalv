-- Analítica en bolivianos, para poder sumar varias urbanizaciones.
--
-- Hoy todas las cifras de analítica salen en la moneda del proyecto
-- (price_agreed, installments.amount). Con un solo proyecto en BOB eso no se
-- nota, pero el módulo de urbanizaciones deja crear un proyecto en USD, y en el
-- momento en que exista, un total consolidado estaría sumando dólares con
-- bolivianos y mostrando una cifra que no significa nada.
--
-- Los pagos y egresos ya guardan amount_bob con el tipo de cambio del día en
-- que ocurrieron. Ventas y cuotas no guardan tipo de cambio, así que se
-- convierten al cambio actual del proyecto. Para un reporte gerencial es lo
-- correcto —"cuánto vale hoy la cartera"— pero NO es lo mismo que la
-- contabilidad, que usa el cambio histórico. Por eso las columnas viejas se
-- conservan tal cual: una urbanización sola se sigue leyendo en su moneda.
--
-- Las columnas nuevas van al FINAL de cada vista: create or replace no permite
-- insertarlas en el medio.

create or replace function private.to_bob(
  p_amount numeric, p_currency char(3), p_project_id uuid
)
returns numeric
language sql
stable
set search_path = public, private, extensions, pg_temp
as $$
  select case
    when p_amount is null then null
    when coalesce(p_currency, 'BOB') = 'BOB' then p_amount
    else round(p_amount * coalesce(
      (private.get_setting(p_project_id, 'exchange_rate_bob_per_usd'))::numeric, 6.96), 2)
  end;
$$;

-- ---------------------------------------------------------------- colocación
create or replace view public.v_an_colocacion
with (security_invoker = true) as
select r.project_id,
       date_trunc('month', (r.confirmed_at at time zone 'America/La_Paz'))::date as mes,
       count(*) as lotes_colocados,
       sum(r.price_agreed) as valor_colocado,
       round(avg(r.price_agreed), 2) as ticket_promedio,
       round(sum(r.price_agreed) / nullif(sum(l.area_m2), 0), 2) as precio_m2_realizado,
       count(*) filter (where r.source = 'oficina') as por_oficina,
       count(*) filter (where r.source = 'web') as por_web,
       -- Normalizado: es lo único que se puede sumar entre urbanizaciones.
       sum(private.to_bob(r.price_agreed, r.currency, r.project_id)) as valor_colocado_bob,
       round(avg(private.to_bob(r.price_agreed, r.currency, r.project_id)), 2) as ticket_promedio_bob,
       round(sum(private.to_bob(r.price_agreed, r.currency, r.project_id))
             / nullif(sum(l.area_m2), 0), 2) as precio_m2_realizado_bob,
       sum(l.area_m2) as area_colocada
  from public.reservations r
  join public.lots l on l.id = r.lot_id
 where r.confirmed_at is not null
 group by r.project_id, 2;

-- ------------------------------------------------------------------- equipo
create or replace view public.v_an_equipo
with (security_invoker = true) as
select pr.id as profile_id,
       pr.full_name,
       pr.role::text as rol,
       coalesce(v.project_id, s.project_id) as project_id,
       coalesce(s.ventas, 0) as ventas_cerradas,
       coalesce(s.monto, 0) as monto_vendido,
       coalesce(v.verificados, 0) as pagos_verificados,
       coalesce(s.monto_bob, 0) as monto_vendido_bob
  from public.profiles pr
  left join (
    select r.verified_by, r.project_id, count(*) as ventas,
           sum(r.price_agreed) as monto,
           sum(private.to_bob(r.price_agreed, r.currency, r.project_id)) as monto_bob
      from public.reservations r
     where r.confirmed_at is not null and r.verified_by is not null
     group by r.verified_by, r.project_id) s on s.verified_by = pr.id
  left join (
    select p.verified_by, p.project_id, count(*) as verificados
      from public.payments p
     where p.status = 'aprobado' and p.verified_by is not null
     group by p.verified_by, p.project_id) v on v.verified_by = pr.id
 where pr.is_active;

-- -------------------------------------------------------------------- aging
create or replace view public.v_an_aging
with (security_invoker = true) as
with tramos as (
  select i.project_id,
         case when i.due_date >= current_date then 'Por vencer'
              when current_date - i.due_date between  1 and 30 then '1-30 dias'
              when current_date - i.due_date between 31 and 60 then '31-60 dias'
              when current_date - i.due_date between 61 and 90 then '61-90 dias'
              else '90+ dias' end as tramo,
         case when i.due_date >= current_date then 0
              when current_date - i.due_date between  1 and 30 then 1
              when current_date - i.due_date between 31 and 60 then 2
              when current_date - i.due_date between 61 and 90 then 3
              else 4 end as orden,
         p.reservation_id,
         i.amount - i.amount_paid as saldo,
         private.to_bob(i.amount - i.amount_paid, i.currency, i.project_id) as saldo_bob
    from public.installments i
    join public.installment_plans p on p.id = i.plan_id
   where i.status in ('pendiente', 'parcial') and p.status = 'activo'
)
select project_id, tramo, orden,
       count(*) as cuotas,
       count(distinct reservation_id) as clientes,
       sum(saldo) as monto,
       sum(saldo_bob) as monto_bob
  from tramos
 group by project_id, tramo, orden;

-- --------------------------------------------------------------- proyección
create or replace view public.v_an_proyeccion
with (security_invoker = true) as
select i.project_id,
       date_trunc('month', i.due_date::timestamptz)::date as mes,
       sum(i.amount - i.amount_paid) as por_cobrar,
       count(*) as cuotas,
       count(distinct i.plan_id) as planes,
       sum(private.to_bob(i.amount - i.amount_paid, i.currency, i.project_id)) as por_cobrar_bob
  from public.installments i
  join public.installment_plans p on p.id = i.plan_id
 where i.status in ('pendiente', 'parcial') and p.status = 'activo'
   and i.due_date >= date_trunc('month', current_date::timestamptz)
 group by i.project_id, 2;

grant select on public.v_an_colocacion, public.v_an_equipo,
                public.v_an_aging, public.v_an_proyeccion to authenticated;
