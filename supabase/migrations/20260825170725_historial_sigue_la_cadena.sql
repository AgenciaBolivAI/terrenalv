-- El historial de pagos sigue la CADENA del lote.
--
-- Una venta recibida por traspaso mostraba «Todavía no hay pagos registrados
-- acá» mientras el mismo detalle decía «Pagado Bs 35.000 (del comprador
-- anterior)»: los pagos viven en la reserva del cedente, y la pantalla solo
-- miraba la propia. La plata que entró por este lote ES historia de este lote
-- — con el nombre de quien la pagó y su recibo, que sigue siendo suyo.
--
-- Regla: se ven los pagos de los eslabones ANTERIORES y del propio, nunca los
-- posteriores: si mañana este comprador cede el lote, los pagos del siguiente
-- dueño no son asunto suyo.

-- Cada eslabón sabe su raíz, su nivel y la punta viva de su cadena.
create or replace view public.v_cadena_ventas
with (security_invoker = true) as
with recursive cadena as (
  select r.id as raiz, r.id as eslabon, 0 as nivel
    from public.reservations r
   where not (r.client_meta ? 'traspaso')
  union all
  select c.raiz, r.id, c.nivel + 1
    from cadena c
    join public.reservations r
      on (r.client_meta->'traspaso'->>'de_reservation')::uuid = c.eslabon
),
puntas as (
  select distinct on (raiz) raiz, eslabon as punta
    from cadena order by raiz, nivel desc
)
select c.eslabon as reservation_id, c.raiz, c.nivel, p.punta
  from cadena c join puntas p on p.raiz = c.raiz;

grant select on public.v_cadena_ventas to authenticated;

-- El historial que ve una venta: el suyo y el de sus antecesores.
create or replace view public.v_historial_pagos_cadena
with (security_invoker = true) as
select x.reservation_id as venta_id,
       h.payment_id,
       h.reservation_id,
       h.project_id,
       h.tracking_code,
       h.buyer_full_name,
       h.reference_code,
       h.purpose,
       h.tipo,
       h.provider,
       h.forma,
       h.amount,
       h.currency,
       h.amount_bob,
       h.exchange_rate_used,
       h.estado,
       h.fecha,
       h.verified_at,
       h.created_at,
       h.tiene_comprobante,
       h.motivo_rechazo,
       h.tiene_recibo,
       h.ci_norm,
       h.proyecto,
       (h.reservation_id <> x.reservation_id) as de_comprador_anterior,
       y.nivel as nivel_del_pago
  from public.v_cadena_ventas x
  join public.v_cadena_ventas y on y.raiz = x.raiz and y.nivel <= x.nivel
  join public.v_historial_pagos h on h.reservation_id = y.reservation_id;

grant select on public.v_historial_pagos_cadena to authenticated;
