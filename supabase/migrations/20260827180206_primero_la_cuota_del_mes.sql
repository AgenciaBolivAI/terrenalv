-- La cuota del mes manda, y el arrastre viaja solo.
--
-- Lo que pidió el dueño, tal cual: si el comprador paga PARTE de su cuota, la
-- diferencia se suma a la siguiente; si paga DE MÁS, la siguiente baja. Eso la
-- cascada de admin_register_cuota_payment ya lo hace sola (asigna de la cuota
-- más vieja hacia adelante), pero ninguna pantalla DECÍA cuánto es «la cuota
-- que toca ahora» con el arrastre incluido. Y el abono a capital (amortizar)
-- es otra cosa: solo se permite con la cuota del mes ya pagada — «you can't
-- add to capital owing your current month».
--
-- 1) Guardián: abonar a capital con una cuota del mes (o vencida) sin pagar
--    rebota con ABONO_CON_CUOTA_DEL_MES.
-- 2) v_cartera gana `proximo_cobro` (al final, como siempre): lo que hay que
--    cobrar para poner al cliente al día este mes — cuotas vencidas y la del
--    mes, menos lo ya adelantado. Si está al día, la falta de la próxima.

do $$
declare
  v_src text;
  v_old text := $blk$  v_tasa := coalesce(v_plan.monthly_interest_pct, 0);$blk$;
  v_new text := $blk$  v_tasa := coalesce(v_plan.monthly_interest_pct, 0);

  -- Primero la cuota del mes: no se abona a capital debiendo la cuota
  -- corriente ni las vencidas. El abono es plata EXTRA, no la cuota disfrazada.
  if v_destino = 'capital' and v_plan.id is not null then
    if exists (
      select 1 from public.installments i
       where i.plan_id = v_plan.id and i.status in ('pendiente', 'parcial')
         and i.due_date <= (date_trunc('month', (now() at time zone 'America/La_Paz'))
                            + interval '1 month - 1 day')::date
    ) then
      raise exception 'ABONO_CON_CUOTA_DEL_MES'
        using detail = 'Cobrá primero la cuota del mes (y las vencidas); recién después se abona a capital.';
    end if;
  end if;$blk$;
begin
  select pg_get_functiondef(oid) into v_src
  from pg_proc where proname = 'admin_register_cuota_payment' and pronamespace = 'public'::regnamespace;
  if position(v_old in v_src) = 0 then
    raise exception 'no encontré el punto de anclaje en admin_register_cuota_payment';
  end if;
  if (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'el anclaje aparece más de una vez: parche ambiguo';
  end if;
  execute replace(v_src, v_old, v_new);
end $$;

create or replace view public.v_cartera as
 SELECT v.project_id,
    v.reservation_id,
    v.tracking_code AS codigo,
    v.proyecto,
    v.manzana,
    v.lote,
    l.area_m2 AS sup_m2,
    v.buyer_full_name AS cliente,
    v.buyer_ci AS ci,
    v.buyer_phone AS telefono,
    v.fecha_venta,
        CASE
            WHEN pl.plan_id IS NOT NULL THEN 'Crédito'::text
            ELSE 'Contado'::text
        END AS modalidad,
    v.price_agreed AS monto_venta,
    'Bs'::text AS moneda,
    COALESCE(pl.down_payment, v.pagado_total) AS pago_inicial,
    pl.months AS plazo_meses,
    pl.monthly_amount AS monto_cuota,
    COALESCE(pl.monthly_interest_pct, 0::numeric) AS interes_mensual_pct,
    v.pagado_total AS pagado,
    v.saldo,
    COALESCE(pl.cuotas_pagadas, 0::bigint) AS cuotas_pagadas,
    COALESCE(pl.cuotas_vencidas, 0::bigint) AS cuotas_vencidas,
    COALESCE(pl.monto_vencido, 0::numeric) AS monto_vencido,
    pl.proxima_cuota,
        CASE
            WHEN v.saldo <= 0::numeric THEN 'Pagado'::text
            WHEN COALESCE(pl.cuotas_vencidas, 0::bigint) >= 3 THEN 'Vencido'::text
            WHEN COALESCE(pl.cuotas_vencidas, 0::bigint) >= 1 THEN 'Atrasado'::text
            ELSE 'Vigente'::text
        END AS estado_cartera,
    p.full_name AS promotor,
    v.origen_label AS origen,
    v.titular,
    v.titular_nombre,
    v.ultimo_pago AS fecha_ultimo_pago,
    EXTRACT(day FROM COALESCE(pl.proxima_cuota, pl.first_due_date))::integer AS dia_de_pago,
    -- Lo que hay que cobrar para poner al cliente al día ESTE mes: las cuotas
    -- vencidas y la del mes con su arrastre (un pago parcial deja su
    -- diferencia aquí; un pago adelantado la descuenta). Al día ⇒ la falta de
    -- la próxima cuota.
        CASE
            WHEN pc.vencido_al_mes > 0::numeric THEN pc.vencido_al_mes
            ELSE pc.primera_falta
        END AS proximo_cobro
   FROM v_ventas v
     LEFT JOIN lots l ON l.id = (( SELECT r.lot_id
           FROM reservations r
          WHERE r.id = v.reservation_id))
     LEFT JOIN profiles p ON p.id = (( SELECT r.sold_by
           FROM reservations r
          WHERE r.id = v.reservation_id))
     LEFT JOIN LATERAL ( SELECT pp.plan_id,
            pp.down_payment,
            pp.months,
            pp.monthly_amount,
            pp.monthly_interest_pct,
            pp.cuotas_pagadas,
            pp.cuotas_vencidas,
            pp.monto_vencido,
            pp.proxima_cuota,
            pp.first_due_date
           FROM v_planes pp
          WHERE pp.reservation_id = v.reservation_id
          ORDER BY (pp.estado = 'activo'::text) DESC, pp.first_due_date DESC
         LIMIT 1) pl ON true
     LEFT JOIN LATERAL ( SELECT
            COALESCE(sum(i.amount - i.amount_paid) FILTER (
              WHERE i.due_date <= (date_trunc('month', (now() AT TIME ZONE 'America/La_Paz'))
                                   + interval '1 month - 1 day')::date), 0::numeric) AS vencido_al_mes,
            (array_agg(i.amount - i.amount_paid ORDER BY i.due_date))[1] AS primera_falta
           FROM installments i
          WHERE i.plan_id = pl.plan_id AND i.status IN ('pendiente', 'parcial')) pc ON true;

alter view public.v_cartera set (security_invoker = true);
