-- Cada pago dice cuánto fue al precio y cuánto fue interés.
--
-- El estado de cuenta listaba «Cuota Bs 646» a secas. El comprador suma sus
-- pagos —646 + 400 = 1.046—, mira el saldo, y la resta no le da: de esos 646,
-- Bs 407,48 fueron el interés del mes y solo 238,52 bajaron el precio del
-- lote. La cifra estaba guardada (payments.interest_bob) y ninguna vista la
-- sacaba, así que ninguna pantalla podía explicarlo.
--
-- La regla que el papel tiene que decir: CADA PAGO CUBRE PRIMERO EL INTERÉS
-- DEL MES y recién el sobrante baja el precio. Verificado por experimento
-- sobre el motor real: pagando 100, 200, 107,48 y 239,51 sobre una cuota de
-- 646,99 con 407,48 de interés, los primeros 407,48 fueron íntegros a interés
-- y el saldo del lote no se movió hasta el cuarto pago. Por eso, con 646
-- pagados de 646,99, el interés quedó cubierto entero y los 0,99 que faltaron
-- salieron del CAPITAL.
--
-- Las columnas se agregan AL FINAL, como siempre.
create or replace view public.v_historial_pagos as
 SELECT p.project_id,
    p.reservation_id,
    r.tracking_code,
    r.buyer_full_name,
    p.id AS payment_id,
    p.reference_code,
    p.purpose,
        CASE
            WHEN p.purpose = 'reserva'::text THEN 'Seña / reserva'::text
            WHEN (p.purpose = ANY (ARRAY['cuota'::text, 'abono'::text])) AND (EXISTS ( SELECT 1
               FROM installment_plans pl
              WHERE pl.reservation_id = p.reservation_id AND p.created_at < pl.created_at)) THEN 'Cuota inicial'::text
            WHEN p.purpose = 'cuota'::text THEN 'Cuota'::text
            WHEN p.purpose = 'abono'::text THEN 'Abono'::text
            WHEN p.purpose = 'comision'::text THEN 'Comisión del mercado'::text
            ELSE p.purpose
        END AS tipo,
    p.provider,
    private.forma_de_pago(p.provider) AS forma,
    p.amount,
    p.currency,
    p.amount_bob,
    p.exchange_rate_used,
    p.status::text AS estado,
    (p.verified_at AT TIME ZONE 'America/La_Paz'::text)::date AS fecha,
    p.verified_at,
    p.created_at,
    p.proof_storage_path IS NOT NULL AS tiene_comprobante,
    p.rejection_reason::text AS motivo_rechazo,
    p.status = 'aprobado'::payment_status AS tiene_recibo,
    r.buyer_ci_normalized AS ci_norm,
    pr.name AS proyecto,
    r.buyer_phone,
    -- Lo que este pago pagó de interés, y lo que bajó el precio del lote.
    -- Suman siempre amount_bob: ni se pierde ni se inventa un centavo.
    COALESCE(p.interest_bob, 0::numeric) AS interes_bob,
    p.amount_bob - COALESCE(p.interest_bob, 0::numeric) AS capital_bob
   FROM payments p
     JOIN reservations r ON r.id = p.reservation_id
     JOIN projects pr ON pr.id = p.project_id;

alter view public.v_historial_pagos set (security_invoker = true);

create or replace view public.v_historial_pagos_cadena as
 SELECT x.reservation_id AS venta_id,
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
    h.reservation_id <> x.reservation_id AS de_comprador_anterior,
    y.nivel AS nivel_del_pago,
    h.buyer_phone,
    h.interes_bob,
    h.capital_bob
   FROM v_cadena_ventas x
     JOIN v_cadena_ventas y ON y.raiz = x.raiz AND y.nivel <= x.nivel
     JOIN v_historial_pagos h ON h.reservation_id = y.reservation_id;

alter view public.v_historial_pagos_cadena set (security_invoker = true);
