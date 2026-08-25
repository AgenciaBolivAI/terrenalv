-- El teléfono del comprador en el historial de pagos, para poder mandar
-- CUALQUIER recibo por WhatsApp de un toque — no solo el que se acaba de
-- cobrar. (Va al final de la lista de columnas: create or replace no permite
-- insertarla en el medio.)
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
         when 'reserva'  then 'Seña / reserva'
         when 'cuota'    then 'Cuota'
         when 'abono'    then 'Abono'
         when 'comision' then 'Comisión del mercado'
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
       (p.status = 'aprobado') as tiene_recibo,
       r.buyer_ci_normalized as ci_norm,
       pr.name as proyecto,
       r.buyer_phone
  from public.payments p
  join public.reservations r on r.id = p.reservation_id
  join public.projects pr on pr.id = p.project_id;

grant select on public.v_historial_pagos to authenticated;

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
       y.nivel as nivel_del_pago,
       h.buyer_phone
  from public.v_cadena_ventas x
  join public.v_cadena_ventas y on y.raiz = x.raiz and y.nivel <= x.nivel
  join public.v_historial_pagos h on h.reservation_id = y.reservation_id;

grant select on public.v_historial_pagos_cadena to authenticated;
