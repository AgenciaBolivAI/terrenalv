-- La plata entregada antes del plan ES la cuota inicial.
--
-- La vista ya sabía llamarla así, pero comparaba `p.created_at < pl.created_at`
-- —estrictamente menor— y el cobro de la inicial y el armado del plan pasan en
-- el mismo acto, con el MISMO timestamp al microsegundo. Empatados, la
-- comparación daba falso y el pago quedaba rotulado «Abono»: un abono a
-- capital de un plan que en ese momento todavía no existía, que es justamente
-- lo que no se puede hacer. Con `<=` la inicial se llama por su nombre.
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
              WHERE pl.reservation_id = p.reservation_id AND p.created_at <= pl.created_at)) THEN 'Cuota inicial'::text
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
    COALESCE(p.interest_bob, 0::numeric) AS interes_bob,
    p.amount_bob - COALESCE(p.interest_bob, 0::numeric) AS capital_bob
   FROM payments p
     JOIN reservations r ON r.id = p.reservation_id
     JOIN projects pr ON pr.id = p.project_id;

alter view public.v_historial_pagos set (security_invoker = true);
