-- La cuota inicial es, exactamente, lo que NO se financió.
--
-- El intento anterior sumaba down_payment + los pagos previos al plan, y en
-- casi todos los planes la cuota inicial está registrada de las DOS formas —
-- como down_payment y como pago— así que salía el doble (Bs 11.000 en un plan
-- cuya inicial fue Bs 5.500).
--
-- La definición que no se puede equivocar es la resta: lo que no se financió
-- es lo que se puso al principio. Y hace cerrar las tres cifras que se
-- muestran juntas: precio − inicial = financiado.
create or replace view public.v_planes as
 SELECT pl.id AS plan_id,
    pl.project_id,
    pl.reservation_id,
    pr.name AS proyecto,
    r.tracking_code,
    r.buyer_full_name,
    r.buyer_phone,
    r.buyer_ci,
    m.code AS manzana,
    l.number AS lote,
    pl.status::text AS estado,
    pl.total_price,
    pl.down_payment,
    pl.financed_amount,
    pl.months,
    pl.monthly_amount,
    pl.annual_interest_pct,
    pl.first_due_date,
    pl.currency,
    COALESCE(c.cuotas, 0::bigint) AS cuotas_totales,
    COALESCE(c.pagadas, 0::bigint) AS cuotas_pagadas,
    COALESCE(c.vencidas, 0::bigint) AS cuotas_vencidas,
    COALESCE(c.pagado, 0::numeric) AS pagado,
    COALESCE(c.pendiente, 0::numeric) AS saldo,
    COALESCE(c.vencido, 0::numeric) AS monto_vencido,
    c.proxima_cuota,
    c.dias_atraso,
        CASE
            WHEN COALESCE(c.cuotas, 0::bigint) > 0 THEN round(COALESCE(c.pagadas, 0::bigint)::numeric * 100::numeric / c.cuotas::numeric, 1)
            ELSE 0::numeric
        END AS avance_pct,
    pl.monthly_interest_pct,
    COALESCE(c.total_cuotas, 0::numeric) AS total_a_pagar,
    COALESCE(c.total_interes, 0::numeric) AS intereses_totales,
    COALESCE(s.total, 0::numeric) AS sena_pagada,
    round(pl.total_price - pl.financed_amount, 2) AS cuota_inicial
   FROM installment_plans pl
     JOIN projects pr ON pr.id = pl.project_id
     JOIN reservations r ON r.id = pl.reservation_id
     LEFT JOIN lots l ON l.id = r.lot_id
     LEFT JOIN manzanas m ON m.id = l.manzana_id
     LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE i.status <> 'anulada'::installment_status) AS cuotas,
            count(*) FILTER (WHERE i.status = 'pagada'::installment_status) AS pagadas,
            count(*) FILTER (WHERE (i.status = ANY (ARRAY['pendiente'::installment_status, 'parcial'::installment_status])) AND i.due_date < CURRENT_DATE) AS vencidas,
            sum(i.amount_paid) AS pagado,
            sum(
                CASE
                    WHEN i.status = ANY (ARRAY['pendiente'::installment_status, 'parcial'::installment_status]) THEN i.amount - i.amount_paid
                    ELSE 0::numeric
                END) AS pendiente,
            sum(
                CASE
                    WHEN (i.status = ANY (ARRAY['pendiente'::installment_status, 'parcial'::installment_status])) AND i.due_date < CURRENT_DATE THEN i.amount - i.amount_paid
                    ELSE 0::numeric
                END) AS vencido,
            min(
                CASE
                    WHEN i.status = ANY (ARRAY['pendiente'::installment_status, 'parcial'::installment_status]) THEN i.due_date
                    ELSE NULL::date
                END) AS proxima_cuota,
            max(
                CASE
                    WHEN (i.status = ANY (ARRAY['pendiente'::installment_status, 'parcial'::installment_status])) AND i.due_date < CURRENT_DATE THEN CURRENT_DATE - i.due_date
                    ELSE NULL::integer
                END) AS dias_atraso,
            sum(
                CASE
                    WHEN i.status <> 'anulada'::installment_status THEN i.amount
                    ELSE 0::numeric
                END) AS total_cuotas,
            sum(
                CASE
                    WHEN i.status <> 'anulada'::installment_status THEN i.interes
                    ELSE 0::numeric
                END) AS total_interes
           FROM installments i
          WHERE i.plan_id = pl.id) c ON true
     LEFT JOIN LATERAL ( SELECT sum(p.amount_bob) AS total
           FROM payments p
          WHERE p.reservation_id = pl.reservation_id AND p.purpose = 'reserva'::text AND p.status = 'aprobado'::payment_status) s ON true;

alter view public.v_planes set (security_invoker = true);
