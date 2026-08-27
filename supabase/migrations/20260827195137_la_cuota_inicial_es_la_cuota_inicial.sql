-- 1) REPROGRAMAR UN PLAN ESTABA ROTO.
--
-- admin_editar_plan dejaba `financed_amount` en el capital que falta pero no
-- tocaba `base_amount`, y el guardián plan_amounts_coherent exige
-- financed = base − inicial. Cualquier plan CON PAGOS reventaba al editar sus
-- condiciones: «Editar condiciones» no servía en producción para los planes
-- vivos, que son los únicos que uno quiere editar. Al reprogramar, la base
-- pasa a ser lo que queda por financiar más lo que se puso de inicial.
do $$
declare
  v_src text;
  v_old text := $blk$         financed_amount = (select round(sum(i.amount - i.interes), 2)
                              from public.installments i
                             where i.plan_id = p_plan_id and i.status <> 'anulada'),$blk$;
  v_new text := $blk$         financed_amount = (select round(sum(i.amount - i.interes), 2)
                              from public.installments i
                             where i.plan_id = p_plan_id and i.status <> 'anulada'),
         -- La base sigue a lo financiado: el guardián exige
         -- financed = base − inicial, y sin esto reprogramar rebotaba.
         base_amount = down_payment + (select round(sum(i.amount - i.interes), 2)
                              from public.installments i
                             where i.plan_id = p_plan_id and i.status <> 'anulada'),$blk$;
begin
  select pg_get_functiondef(oid) into v_src
  from pg_proc where proname='admin_editar_plan' and pronamespace='public'::regnamespace;
  if position(v_old in v_src) = 0 then
    raise exception 'no encontré el update de admin_editar_plan';
  end if;
  if (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'el update aparece más de una vez: parche ambiguo';
  end if;
  execute replace(v_src, v_old, v_new);
end $$;

-- 2) LA CUOTA INICIAL, DICHA POR LA BASE.
--
-- No es solo `down_payment`: la plata que el comprador entregó ANTES de que el
-- plan existiera es cuota inicial también — la seña y lo que puso al firmar.
-- Por eso el plan de EDS-684B-B2SS mostraba «Cuota inicial Bs 0» al lado de
-- «Financiado Bs 24.400» sobre un lote de Bs 24.800: los 400 no aparecían en
-- ninguna fila, y yo los había puesto como «entregado antes del plan», que es
-- ponerle otro nombre a la cuota inicial.
--
-- Se calcula acá, una vez, y sobrevive a las reprogramaciones (que sí mueven
-- financed_amount). La columna va AL FINAL, como siempre.
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
    -- Todo lo que entró ANTES de que el plan existiera, más lo que se pactó
    -- como inicial. Es la cifra que hace cerrar precio − inicial = financiado.
    round(pl.down_payment + COALESCE(ini.total, 0::numeric), 2) AS cuota_inicial
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
          WHERE p.reservation_id = pl.reservation_id AND p.purpose = 'reserva'::text AND p.status = 'aprobado'::payment_status) s ON true
     LEFT JOIN LATERAL ( SELECT sum(p.amount_bob) AS total
           FROM payments p
          WHERE p.reservation_id = pl.reservation_id
            AND p.status = 'aprobado'::payment_status
            AND p.purpose = ANY (ARRAY['reserva'::text, 'cuota'::text, 'abono'::text])
            AND p.created_at <= pl.created_at) ini ON true;

alter view public.v_planes set (security_invoker = true);
