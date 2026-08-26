-- La seña de una reserva que se cayó es INGRESO, no un anticipo eterno.
--
-- Mientras la reserva vive, la seña es plata que le debemos al comprador si
-- no se concreta: anticipo (2131). Cuando la reserva vence o se cancela, esa
-- plata se pierde para él y queda para la empresa: ingreso (4411). Dejarla en
-- anticipos para siempre sería declarar una deuda con alguien que ya no va a
-- cobrarla.
--
-- Y como el libro se DERIVA del estado, reactivar la reserva devuelve la seña
-- a anticipos sola: no hay que acordarse de revertir nada.
create or replace view public.v_libro_diario
with (security_invoker = true) as
with base_venta as (
  select r.*,
         case
           when r.client_meta ? 'migrado_de'
             then coalesce((r.client_meta->'reportado'->>'deuda')::numeric, r.price_agreed)
           when r.client_meta ? 'traspaso'
             then coalesce((r.client_meta->'traspaso'->>'baseline_original')::numeric, r.price_agreed)
           else r.price_agreed
         end as monto_venta,
         (r.status = 'confirmada' or r.client_meta ? 'traspasada_a') as cadena_viva,
         -- La reserva sigue en pie: su plata todavía es del comprador.
         (r.status in ('pendiente_pago','en_verificacion','rechazo_reintento')) as reserva_viva,
         -- Se cayó: lo que pagó por reservar se pierde.
         (r.status in ('expirada','cancelada') and not (r.client_meta ? 'traspasada_a')) as reserva_caida
    from public.reservations r
)
select r.project_id,
       (r.confirmed_at at time zone 'America/La_Paz')::date as fecha,
       'VTA-' || r.tracking_code as comprobante,
       'Venta de lote — ' || r.buyer_full_name as glosa,
       '1131'::text as cuenta,
       r.monto_venta as debe, 0::numeric as haber,
       r.id as origen_id, 'venta'::text as origen
  from base_venta r
 where r.confirmed_at is not null and r.status = 'confirmada'
union all
select r.project_id,
       (r.confirmed_at at time zone 'America/La_Paz')::date,
       'VTA-' || r.tracking_code,
       'Venta de lote — ' || r.buyer_full_name,
       '4111'::text, 0::numeric, r.monto_venta,
       r.id, 'venta'
  from base_venta r
 where r.confirmed_at is not null and r.status = 'confirmada'
union all
select p.project_id,
       (p.verified_at at time zone 'America/La_Paz')::date,
       'PAGO-' || p.reference_code,
       case p.purpose
         when 'cuota'    then 'Cobro de cuota'
         when 'abono'    then 'Abono al lote'
         when 'comision' then 'Comisión del mercado de traspasos'
         else 'Cobro de seña / reserva'
       end || ' por ' || private.forma_de_pago(p.provider)
         || ' — ' || r.buyer_full_name || ' (' || r.tracking_code || ')',
       coalesce(t.account_code, '1111'),
       p.amount_bob, 0::numeric,
       p.id, 'pago'
  from public.payments p
  join public.reservations r on r.id = p.reservation_id
  left join public.treasury_accounts t on t.id = p.treasury_account_id
 where p.status = 'aprobado' and p.verified_at is not null
union all
select p.project_id,
       (p.verified_at at time zone 'America/La_Paz')::date,
       'PAGO-' || p.reference_code,
       case p.purpose
         when 'cuota'    then 'Cobro de cuota'
         when 'abono'    then 'Abono al lote'
         when 'comision' then 'Comisión del mercado de traspasos'
         else 'Cobro de seña / reserva'
       end || ' por ' || private.forma_de_pago(p.provider)
         || ' — ' || r.buyer_full_name || ' (' || r.tracking_code || ')',
       case
         when p.purpose = 'comision' then '4211'
         -- Seña de una reserva caída: se la queda la empresa.
         when p.purpose = 'reserva' and b.reserva_caida then '4411'
         when b.cadena_viva then '1131'
         else '2131'
       end,
       0::numeric,
       p.amount_bob - coalesce(p.interest_bob, 0),
       p.id, 'pago'
  from public.payments p
  join base_venta b on b.id = p.reservation_id
  join public.reservations r on r.id = p.reservation_id
 where p.status = 'aprobado' and p.verified_at is not null
   and p.amount_bob - coalesce(p.interest_bob, 0) <> 0
union all
select p.project_id,
       (p.verified_at at time zone 'America/La_Paz')::date,
       'PAGO-' || p.reference_code,
       'Interés de financiamiento — ' || r.buyer_full_name || ' (' || r.tracking_code || ')',
       '4311'::text,
       0::numeric, p.interest_bob,
       p.id, 'pago'
  from public.payments p
  join public.reservations r on r.id = p.reservation_id
 where p.status = 'aprobado' and p.verified_at is not null
   and coalesce(p.interest_bob, 0) > 0
union all
select e.project_id, e.incurred_on,
       'EGR-' || left(replace(e.id::text, '-', ''), 10),
       e.description || coalesce(' — ' || coalesce(c.name, e.supplier), ''),
       case e.category
         when 'obra' then '5111' when 'comisiones' then '5211'
         when 'sueldos' then '5221' when 'publicidad' then '5311'
         when 'administracion' then '5411' when 'impuestos' then '5511'
         when 'financiero' then '5611' else '5911'
       end,
       e.amount_bob, 0::numeric, e.id, 'egreso'
  from public.expenses e
  left join public.contacts c on c.id = e.contact_id
 where e.deleted_at is null
union all
select e.project_id, e.incurred_on,
       'EGR-' || left(replace(e.id::text, '-', ''), 10),
       e.description || coalesce(' — ' || coalesce(c.name, e.supplier), ''),
       coalesce(t.account_code, '1111'),
       0::numeric, e.amount_bob, e.id, 'egreso'
  from public.expenses e
  left join public.treasury_accounts t on t.id = e.treasury_account_id
  left join public.contacts c on c.id = e.contact_id
 where e.deleted_at is null
union all
select je.project_id, je.entry_date, je.number,
       je.glosa || coalesce(' — ' || jl.glosa, ''),
       jl.account_code, jl.debe, jl.haber, je.id, 'comprobante'
  from public.journal_entries je
  join public.journal_lines jl on jl.entry_id = je.id
 where je.status = 'registrado';

grant select on public.v_libro_diario to authenticated;

-- ---- La reserva en curso: cuánto lleva juntado y cuánto le falta.
create or replace view public.v_reservas_en_curso
with (security_invoker = true) as
select r.id as reservation_id,
       r.project_id,
       pr.name as proyecto,
       r.tracking_code,
       r.status::text as estado,
       r.buyer_full_name,
       r.buyer_ci,
       r.buyer_phone,
       r.buyer_email,
       m.code as manzana,
       l.number as lote,
       l.area_m2,
       r.price_agreed as precio,
       r.created_at,
       r.hold_expires_at,
       r.retry_expires_at,
       r.expired_at,
       r.cancelled_at,
       r.cancel_reason,
       r.sold_by,
       vp.full_name as vendedor,
       -- La seña que pagó por reservar (aprobada).
       coalesce(sn.total, 0) as sena_pagada,
       -- Lo que viene juntando a cuenta de su cuota inicial.
       coalesce(ab.total, 0) as abonado,
       -- La cuota inicial que le pide su clasificación de precio.
       coalesce((public.condiciones_financiamiento(r.project_id, r.price_agreed)
                 ->>'inicial_sugerida')::numeric, 0) as inicial_objetivo,
       greatest(0, coalesce((public.condiciones_financiamiento(r.project_id, r.price_agreed)
                             ->>'inicial_sugerida')::numeric, 0)
                   - coalesce(sn.total, 0) - coalesce(ab.total, 0)) as falta_para_inicial,
       (r.status in ('pendiente_pago','en_verificacion','rechazo_reintento')) as viva,
       case when r.status in ('pendiente_pago','en_verificacion','rechazo_reintento')
            then greatest(0, extract(epoch from (
                   coalesce(r.retry_expires_at, r.hold_expires_at) - now())) / 3600)
       end as horas_restantes
  from public.reservations r
  join public.projects pr on pr.id = r.project_id
  left join public.profiles vp on vp.id = r.sold_by
  left join public.lots l on l.id = r.lot_id
  left join public.manzanas m on m.id = l.manzana_id
  left join lateral (
    select sum(x.amount_bob) as total from public.payments x
     where x.reservation_id = r.id and x.status = 'aprobado' and x.purpose = 'reserva'
  ) sn on true
  left join lateral (
    select sum(x.amount_bob) as total from public.payments x
     where x.reservation_id = r.id and x.status = 'aprobado' and x.purpose in ('cuota','abono')
  ) ab on true
 where r.status <> 'confirmada';

grant select on public.v_reservas_en_curso to authenticated;
