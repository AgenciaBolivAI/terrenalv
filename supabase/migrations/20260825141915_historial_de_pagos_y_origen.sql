-- De dónde vino cada venta, y el historial completo de lo que pagó cada
-- comprador.
--
-- La oficina necesita distinguir tres caminos que hoy se ven iguales:
--   * el que reservó por la app y después pagó,
--   * el que reservó en el mostrador,
--   * el que no reservó nada y compró directo con la cuota inicial.
-- Son tres conversaciones distintas de cobranza, y hasta ahora la pantalla los
-- mostraba a todos como «venta».
--
-- De aquí en adelante el origen se GUARDA al crear la venta; para las que ya
-- existen se deduce del dato que hay, y la vista dice cuál de las dos cosas es
-- para no hacer pasar una deducción por un hecho.

create or replace function private.origen_de_venta(
  p_source text, p_meta jsonb, p_created timestamptz, p_confirmed timestamptz
)
returns text
language sql
immutable
as $$
  select case
    -- Lo guardado manda sobre cualquier deducción.
    when p_meta ? 'origen' then p_meta->>'origen'
    when p_meta ? 'migrado_de' then 'migrada'
    when coalesce(p_source, 'web') = 'web' then 'app'
    -- Venta de mostrador: si nació confirmada, nunca hubo etapa de reserva.
    when p_confirmed is not null and p_confirmed - p_created < interval '2 minutes'
      then 'oficina_directa'
    else 'oficina_reserva'
  end;
$$;

grant execute on function private.origen_de_venta(text, jsonb, timestamptz, timestamptz)
  to anon, authenticated, service_role;

create or replace function private.etiqueta_origen(p_origen text)
returns text
language sql
immutable
as $$
  select case p_origen
    when 'app'             then 'Reservó por la app'
    when 'oficina_reserva' then 'Reservó en oficina'
    when 'oficina_directa' then 'Venta directa en oficina'
    when 'migrada'         then 'Sistema anterior'
    else 'Otro'
  end;
$$;

grant execute on function private.etiqueta_origen(text) to anon, authenticated, service_role;

-- ==================================================== HISTORIAL DE PAGOS
-- Una fila por pago, de cualquier tipo y estado, con todo lo que la oficina
-- pregunta: cuándo, cuánto, de qué (seña / cuota / abono), por dónde entró y
-- si tiene recibo.
--
-- Incluye los NO aprobados a propósito: un comprobante rechazado explica por
-- qué un comprador jura haber pagado y el saldo no baja. Ocultarlo dejaría esa
-- conversación sin respuesta.
create or replace view public.v_historial_pagos
with (security_invoker = true) as
select p.project_id,
       p.reservation_id,
       r.tracking_code,
       r.buyer_full_name,
       p.id as payment_id,
       p.reference_code,
       p.purpose,
       case p.purpose
         when 'reserva' then 'Seña / reserva'
         when 'cuota'   then 'Cuota'
         when 'abono'   then 'Abono'
         else p.purpose end as tipo,
       p.provider,
       private.forma_de_pago(p.provider) as forma,
       p.amount,
       p.currency,
       p.amount_bob,
       p.exchange_rate_used,
       p.status::text as estado,
       (p.verified_at at time zone 'America/La_Paz')::date as fecha,
       p.verified_at,
       p.created_at,
       p.proof_storage_path is not null as tiene_comprobante,
       p.rejection_reason::text as motivo_rechazo,
       -- Solo un pago aprobado tiene recibo: uno pendiente todavía puede
       -- rechazarse, y no se entrega papel por plata que quizá se devuelva.
       (p.status = 'aprobado') as tiene_recibo
  from public.payments p
  join public.reservations r on r.id = p.reservation_id;

grant select on public.v_historial_pagos to authenticated;

-- ==================================================== VENTAS + ORIGEN
create or replace view public.v_ventas
with (security_invoker = true) as
select r.project_id,
       r.id as reservation_id,
       r.tracking_code,
       r.buyer_full_name,
       r.buyer_ci,
       r.buyer_phone,
       r.buyer_email,
       (r.confirmed_at at time zone 'America/La_Paz')::date as fecha_venta,
       r.price_agreed,
       r.currency,
       m.code as manzana,
       l.number as lote,
       p.name as proyecto,
       (r.client_meta ? 'migrado_de') as migrada,
       coalesce((r.client_meta->'reportado'->>'deuda')::numeric, null) as deuda_migrada,
       coalesce(pg.total, 0) as cobrado_aqui,
       coalesce(pg.cuotas, 0) as pagos_cuota,
       coalesce(pg.abonos, 0) as pagos_abono,
       greatest(0, coalesce((r.client_meta->'reportado'->>'deuda')::numeric, r.price_agreed)
                   - coalesce(pg.total, 0)) as saldo,
       exists (select 1 from public.installment_plans ip
                where ip.reservation_id = r.id and ip.status = 'activo') as con_plan,
       pg.ultimo_pago,
       ((r.client_meta ? 'migrado_de') or coalesce(pg.total, 0) > 0) as compra_iniciada,
       coalesce((r.client_meta->'reportado'->>'abonado')::numeric, 0) as abonado_migrado,
       coalesce((r.client_meta->'reportado'->>'abonado')::numeric, 0) + coalesce(pg.total, 0)
         as pagado_total,
       r.source,
       private.origen_de_venta(r.source, r.client_meta, r.created_at, r.confirmed_at) as origen,
       private.etiqueta_origen(
         private.origen_de_venta(r.source, r.client_meta, r.created_at, r.confirmed_at)
       ) as origen_label,
       -- El origen es un hecho guardado o una deducción por la forma en que
       -- nació la venta: la pantalla lo aclara en vez de afirmarlo a secas.
       (r.client_meta ? 'origen') as origen_declarado,
       -- La seña: cuánto puso para reservar, y cuándo. Cero significa que no
       -- reservó — entró directo con la cuota inicial.
       coalesce(sn.total, 0) as sena_pagada,
       sn.fecha as sena_fecha,
       coalesce(sn.forma, '') as sena_forma
  from public.reservations r
  join public.projects p on p.id = r.project_id
  left join public.lots l on l.id = r.lot_id
  left join public.manzanas m on m.id = l.manzana_id
  left join lateral (
    select sum(x.amount_bob) as total,
           count(*) filter (where x.purpose = 'cuota') as cuotas,
           count(*) filter (where x.purpose = 'abono') as abonos,
           max((x.verified_at at time zone 'America/La_Paz')::date) as ultimo_pago
      from public.payments x
     where x.reservation_id = r.id and x.status = 'aprobado' and x.purpose <> 'reserva'
  ) pg on true
  left join lateral (
    select sum(x.amount_bob) as total,
           max((x.verified_at at time zone 'America/La_Paz')::date) as fecha,
           max(private.forma_de_pago(x.provider)) as forma
      from public.payments x
     where x.reservation_id = r.id and x.status = 'aprobado' and x.purpose = 'reserva'
  ) sn on true
 where r.status = 'confirmada';

grant select on public.v_ventas to authenticated;

-- ==================================================== PLANES DE PAGO
-- Un plan por fila, con su avance real: cuántas cuotas van pagadas, cuántas
-- vencidas, cuánto falta y cuándo cae la próxima.
--
-- Hasta ahora los planes solo se veían de a uno, entrando por el comprador.
-- Sin una lista no hay forma de responder «¿a quién hay que cobrarle esta
-- semana?», que es la pregunta con la que arranca el lunes la cobranza.
create or replace view public.v_planes
with (security_invoker = true) as
select pl.id as plan_id,
       pl.project_id,
       pl.reservation_id,
       pr.name as proyecto,
       r.tracking_code,
       r.buyer_full_name,
       r.buyer_phone,
       r.buyer_ci,
       m.code as manzana,
       l.number as lote,
       pl.status::text as estado,
       pl.total_price,
       pl.down_payment,
       pl.financed_amount,
       pl.months,
       pl.monthly_amount,
       pl.annual_interest_pct,
       pl.first_due_date,
       pl.currency,
       coalesce(c.cuotas, 0) as cuotas_totales,
       coalesce(c.pagadas, 0) as cuotas_pagadas,
       coalesce(c.vencidas, 0) as cuotas_vencidas,
       coalesce(c.pagado, 0) as pagado,
       coalesce(c.pendiente, 0) as saldo,
       coalesce(c.vencido, 0) as monto_vencido,
       c.proxima_cuota,
       c.dias_atraso,
       case when coalesce(c.cuotas, 0) > 0
            then round(coalesce(c.pagadas, 0)::numeric * 100 / c.cuotas, 1)
            else 0 end as avance_pct
  from public.installment_plans pl
  join public.reservations r on r.id = pl.reservation_id
  join public.projects pr on pr.id = pl.project_id
  left join public.lots l on l.id = r.lot_id
  left join public.manzanas m on m.id = l.manzana_id
  left join lateral (
    select count(*) as cuotas,
           count(*) filter (where i.status = 'pagada') as pagadas,
           count(*) filter (where i.status in ('pendiente','parcial') and i.due_date < current_date)
             as vencidas,
           sum(i.amount_paid) as pagado,
           sum(i.amount - i.amount_paid) filter (where i.status in ('pendiente','parcial'))
             as pendiente,
           sum(i.amount - i.amount_paid) filter (
             where i.status in ('pendiente','parcial') and i.due_date < current_date) as vencido,
           min(i.due_date) filter (where i.status in ('pendiente','parcial')) as proxima_cuota,
           (current_date - min(i.due_date) filter (
             where i.status in ('pendiente','parcial') and i.due_date < current_date)) as dias_atraso
      from public.installments i
     where i.plan_id = pl.id
  ) c on true;

grant select on public.v_planes to authenticated;
