-- Analítica del negocio.
--
-- Todo se calcula en Postgres, no en el navegador: son cruces sobre miles de
-- filas y el panel tiene que abrirse rápido. Todas las vistas son
-- security_invoker, así que la RLS de las tablas de abajo se sigue aplicando.
--
-- Cada vista responde una pregunta que cambia una decisión. Si una cifra no
-- cambia ninguna decisión, no está acá.

-- ============================================================================
-- 1. Embudo mensual y conversión
--    "¿De cada 100 que reservan, cuántos terminan pagando, y dónde se caen?"
-- ============================================================================
create or replace view public.v_an_funnel_mensual
with (security_invoker = on) as
select
  r.project_id,
  date_trunc('month', r.created_at at time zone 'America/La_Paz')::date as mes,
  count(*)                                                      as creadas,
  count(*) filter (where exists (
    select 1 from public.payments p
     where p.reservation_id = r.id and p.proof_submitted_at is not null))  as con_comprobante,
  count(*) filter (where r.confirmed_at is not null)             as confirmadas,
  count(*) filter (where r.status = 'expirada')                  as expiradas,
  count(*) filter (where r.status = 'cancelada')                 as canceladas,
  count(*) filter (where r.source = 'web')                       as web,
  count(*) filter (where r.source = 'oficina')                   as oficina,
  -- Conversión final, que es la única tasa por la que se toma una decisión.
  round(100.0 * count(*) filter (where r.confirmed_at is not null)
        / nullif(count(*), 0), 1)                                as tasa_conversion,
  round(100.0 * count(*) filter (where r.status = 'expirada')
        / nullif(count(*), 0), 1)                                as tasa_expiracion
from public.reservations r
group by r.project_id, 2;

-- ============================================================================
-- 2. Velocidad de reacción del comprador y del equipo
--    Medianas, no promedios: un comprador que tardó tres semanas no debe
--    arrastrar la cifra que describe a los demás.
-- ============================================================================
create or replace view public.v_an_tiempos
with (security_invoker = on) as
select
  r.project_id,
  date_trunc('month', r.created_at at time zone 'America/La_Paz')::date as mes,
  -- Del "reservo" al "subí el comprobante": mide al comprador.
  percentile_cont(0.5) within group (
    order by extract(epoch from (p.proof_submitted_at - r.created_at)) / 3600.0
  ) filter (where p.proof_submitted_at is not null)               as horas_hasta_comprobante,
  -- Del comprobante al "aprobado": mide al equipo.
  percentile_cont(0.5) within group (
    order by extract(epoch from (p.verified_at - p.proof_submitted_at)) / 3600.0
  ) filter (where p.verified_at is not null and p.proof_submitted_at is not null)
                                                                   as horas_hasta_verificacion,
  count(*) filter (where p.proof_submitted_at is not null)         as muestras
from public.reservations r
left join public.payments p on p.reservation_id = r.id and p.purpose = 'reserva'
group by r.project_id, 2;

-- ============================================================================
-- 3. Demanda por manzana
--    "¿Qué manzanas se mueven y cuáles están muertas?" — decide dónde abrir
--    calles, dónde poner el esfuerzo de venta y qué manzana bajar de precio.
-- ============================================================================
create or replace view public.v_an_demanda_manzana
with (security_invoker = on) as
select
  m.project_id,
  m.id                                                     as manzana_id,
  m.code                                                   as manzana,
  m.sector,
  count(l.id)                                              as lotes,
  count(l.id) filter (where l.status = 'vendido')           as vendidos,
  count(l.id) filter (where l.status = 'reservado')         as reservados,
  count(l.id) filter (where l.status = 'disponible')        as disponibles,
  round(100.0 * count(l.id) filter (where l.status in ('vendido', 'reservado'))
        / nullif(count(l.id), 0), 1)                        as pct_colocado,
  round(avg(l.area_m2)::numeric, 1)                         as area_promedio,
  round(avg(public.lot_price(l.id))::numeric, 2)            as precio_promedio
from public.manzanas m
left join public.lots l on l.manzana_id = m.id and l.deleted_at is null
group by m.project_id, m.id, m.code, m.sector;

-- ============================================================================
-- 4. Colocación mensual y absorción
--    La cifra que decide si alcanza el inventario: a este ritmo, cuántos meses
--    quedan de terrenos para vender.
-- ============================================================================
create or replace view public.v_an_colocacion
with (security_invoker = on) as
select
  r.project_id,
  date_trunc('month', r.confirmed_at at time zone 'America/La_Paz')::date as mes,
  count(*)                                                  as lotes_colocados,
  sum(r.price_agreed)                                       as valor_colocado,
  round(avg(r.price_agreed)::numeric, 2)                    as ticket_promedio,
  round((sum(r.price_agreed) / nullif(sum(l.area_m2), 0))::numeric, 2) as precio_m2_realizado,
  count(*) filter (where r.source = 'oficina')              as por_oficina,
  count(*) filter (where r.source = 'web')                  as por_web
from public.reservations r
join public.lots l on l.id = r.lot_id
where r.confirmed_at is not null
group by r.project_id, 2;

-- ============================================================================
-- 5. Antigüedad de saldos (aging)
--    El estándar con el que se mide una cartera: cuanto más vieja la deuda,
--    menos probable que entre.
-- ============================================================================
create or replace view public.v_an_aging
with (security_invoker = on) as
select
  i.project_id,
  case
    when i.due_date >= current_date                          then 'Por vencer'
    when current_date - i.due_date between 1 and 30          then '1-30 días'
    when current_date - i.due_date between 31 and 60         then '31-60 días'
    when current_date - i.due_date between 61 and 90         then '61-90 días'
    else '90+ días'
  end                                                        as tramo,
  case
    when i.due_date >= current_date then 0
    when current_date - i.due_date between 1 and 30 then 1
    when current_date - i.due_date between 31 and 60 then 2
    when current_date - i.due_date between 61 and 90 then 3
    else 4
  end                                                        as orden,
  count(*)                                                   as cuotas,
  count(distinct p.reservation_id)                           as clientes,
  sum(i.amount - i.amount_paid)                              as monto
from public.installments i
join public.installment_plans p on p.id = i.plan_id
where i.status in ('pendiente', 'parcial') and p.status = 'activo'
group by i.project_id, 2, 3;

-- ============================================================================
-- 6. Proyección de cobranza
--    Lo que ninguna otra pantalla puede decir: cuánta plata está comprometida
--    a entrar mes a mes según los planes ya firmados.
-- ============================================================================
create or replace view public.v_an_proyeccion
with (security_invoker = on) as
select
  i.project_id,
  date_trunc('month', i.due_date)::date                      as mes,
  sum(i.amount - i.amount_paid)                              as por_cobrar,
  count(*)                                                   as cuotas,
  count(distinct i.plan_id)                                  as planes
from public.installments i
join public.installment_plans p on p.id = i.plan_id
where i.status in ('pendiente', 'parcial')
  and p.status = 'activo'
  and i.due_date >= date_trunc('month', current_date)
group by i.project_id, 2;

-- ============================================================================
-- 7. Rendimiento del equipo
--    Quién cierra ventas en oficina y quién verifica comprobantes.
-- ============================================================================
create or replace view public.v_an_equipo
with (security_invoker = on) as
select
  pr.id                                                      as profile_id,
  pr.full_name,
  pr.role::text                                              as rol,
  coalesce(v.project_id, s.project_id)                       as project_id,
  coalesce(s.ventas, 0)                                      as ventas_cerradas,
  coalesce(s.monto, 0)                                       as monto_vendido,
  coalesce(v.verificados, 0)                                 as pagos_verificados
from public.profiles pr
left join (
  select r.verified_by, r.project_id, count(*) as ventas, sum(r.price_agreed) as monto
    from public.reservations r
   where r.confirmed_at is not null and r.verified_by is not null
   group by 1, 2
) s on s.verified_by = pr.id
left join (
  select p.verified_by, p.project_id, count(*) as verificados
    from public.payments p
   where p.status = 'aprobado' and p.verified_by is not null
   group by 1, 2
) v on v.verified_by = pr.id
where pr.is_active;

grant select on
  public.v_an_funnel_mensual,
  public.v_an_tiempos,
  public.v_an_demanda_manzana,
  public.v_an_colocacion,
  public.v_an_aging,
  public.v_an_proyeccion,
  public.v_an_equipo
to authenticated;
