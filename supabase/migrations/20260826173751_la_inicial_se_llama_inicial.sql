-- Tres incongruencias del mismo panel, arregladas de raíz.
--
-- 1. El recibo decía «Cuota» donde el comprador pagó su cuota inicial. La
--    regla es del propio negocio: el plan financia lo que queda DESPUÉS de la
--    inicial, así que todo pago de cuota/abono anterior a que el plan exista
--    ES la inicial (o parte de ella). Se etiqueta por esa verdad, no por una
--    marca manual que alguien puede olvidar.
--
-- 2. «Financiado» mostraba Bs 45.000 en un plan que financia Bs 44.000: los
--    cinco planes a los que se les ajustó la última cuota seguían mostrando
--    el número de antes en su encabezado. El financiado real es el capital
--    de sus cuotas, así que se recalcula de ahí.
--
-- 3. El panel de condiciones no decía cuánto puso de seña, y el recibo sí.
--    v_planes ahora la trae, para que las dos pantallas cuenten lo mismo.

-- ---------- 1. la etiqueta -------------------------------------------------
create or replace view public.v_historial_pagos as
select p.project_id,
    p.reservation_id,
    r.tracking_code,
    r.buyer_full_name,
    p.id as payment_id,
    p.reference_code,
    p.purpose,
    case
      when p.purpose = 'reserva' then 'Seña / reserva'
      -- La inicial: pagos de cuota/abono hechos antes de que existiera el
      -- primer plan de la venta. El plan financia lo que queda después de
      -- la inicial, así que lo anterior al plan es inicial por definición.
      when p.purpose in ('cuota','abono')
       and exists (select 1 from public.installment_plans pl
                    where pl.reservation_id = p.reservation_id
                      and p.created_at < pl.created_at)
        then 'Cuota inicial'
      when p.purpose = 'cuota' then 'Cuota'
      when p.purpose = 'abono' then 'Abono'
      when p.purpose = 'comision' then 'Comisión del mercado'
      else p.purpose
    end as tipo,
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
    p.status = 'aprobado'::payment_status as tiene_recibo,
    r.buyer_ci_normalized as ci_norm,
    pr.name as proyecto,
    r.buyer_phone
  from public.payments p
  join public.reservations r on r.id = p.reservation_id
  join public.projects pr on pr.id = p.project_id;

alter view public.v_historial_pagos set (security_invoker = true);

-- ---------- 2. el encabezado del plan --------------------------------------
-- El financiado ES el capital de sus cuotas. Se recalcula para los planes
-- ajustados (los marcados con la nota del ajuste), no para todos: en los
-- demás ya coincide y no hay por qué tocar historia sana.
update public.installment_plans pl
   set financed_amount = c.capital,
       base_amount = round(c.capital + pl.down_payment, 2),
       updated_at = now()
  from (select i.plan_id, round(sum(i.amount - i.interes), 2) as capital
          from public.installments i
         where i.status <> 'anulada'
         group by i.plan_id) c
 where c.plan_id = pl.id
   and pl.note like '%seña aplicada al precio%'
   and pl.financed_amount <> c.capital;

-- ---------- 3. la seña en las condiciones ----------------------------------
-- Columna nueva AL FINAL (create or replace no admite meterla en el medio).
create or replace view public.v_planes as
select v.*, coalesce(s.total, 0) as sena_pagada
  from (select * from public.v_planes) v
  join public.installment_plans pl on pl.id = v.plan_id
  left join lateral (
    select sum(p.amount_bob) as total
      from public.payments p
     where p.reservation_id = pl.reservation_id
       and p.purpose = 'reserva' and p.status = 'aprobado'
  ) s on true;
