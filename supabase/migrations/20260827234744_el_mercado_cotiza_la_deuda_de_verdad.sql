-- LA VIDRIERA COTIZABA MAL LA DEUDA QUE EL INTERESADO VA A ASUMIR.
--
-- `saldo_a_asumir` sumaba amount_bob de cuotas y abonos: dejaba afuera la SEÑA
-- (que sí se aplicó al precio, y así infla la deuda) y contaba como capital el
-- INTERÉS cobrado (que la baja de menos). El resto del sistema —v_ventas.saldo,
-- private.capital_pagado, el traspaso— cuenta capital. Un interesado leía una
-- cifra y al firmar le aparecía otra, en el único lugar donde se le pide el
-- teléfono a un desconocido.
--
-- La cuenta va DENTRO del lateral, no llamando private.capital_pagado por fila:
-- es SECURITY DEFINER, el planner no la inlinea y se pagaría una llamada por
-- aviso.
create or replace view public.v_mercado as
 SELECT ml.id AS listing_id,
    pr.name AS proyecto,
    pr.slug,
    m.code AS manzana,
    l.number AS lote,
    l.area_m2,
    r.price_agreed AS precio_lote,
    GREATEST(0::numeric, COALESCE(((r.client_meta -> 'reportado'::text) ->> 'deuda'::text)::numeric, r.price_agreed) - COALESCE(pg.capital, 0::numeric)) AS saldo_a_asumir,
    ml.asking_price_bob,
    ml.note,
    (ml.created_at AT TIME ZONE 'America/La_Paz'::text)::date AS publicada,
    ml.fee_pct,
        CASE
            WHEN GREATEST(0::numeric, COALESCE(((r.client_meta -> 'reportado'::text) ->> 'deuda'::text)::numeric, r.price_agreed) - COALESCE(pg.capital, 0::numeric)) > 0::numeric THEN 'traspaso'::text
            ELSE 'venta'::text
        END AS tipo
   FROM market_listings ml
     JOIN reservations r ON r.id = ml.reservation_id
     JOIN projects pr ON pr.id = r.project_id
     LEFT JOIN lots l ON l.id = r.lot_id
     LEFT JOIN manzanas m ON m.id = l.manzana_id
     LEFT JOIN LATERAL ( SELECT sum(x.amount_bob - COALESCE(x.interest_bob, 0::numeric)) AS capital
           FROM payments x
          WHERE x.reservation_id = r.id
            AND x.status = 'aprobado'::payment_status
            -- La seña TAMBIÉN paga el lote, igual que en v_ventas.
            AND (x.purpose = ANY (ARRAY['reserva'::text, 'cuota'::text, 'abono'::text]))) pg ON true
  WHERE ml.status = 'activa'::text AND r.status = 'confirmada'::reservation_status;

alter view public.v_mercado set (security_invoker = true);

-- Y los avisos de PRUEBA salen de la vidriera pública: dos publicaciones
-- activas cuyo texto empieza con «DEMO —», una de ellas sobre el lote de un
-- comprador real. Se CIERRAN, no se borran: el historial queda y el dueño
-- puede volver a publicarlas desde el panel cuando quiera.
update public.market_listings
   set status = 'cerrada'
 where status = 'activa' and note ilike 'DEMO%';
