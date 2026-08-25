-- La comisión del mercado en cada pantalla y en los libros.

-- ---- 1. El historial la nombra por lo que es.
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
       pr.name as proyecto
  from public.payments p
  join public.reservations r on r.id = p.reservation_id
  join public.projects pr on pr.id = p.project_id;

grant select on public.v_historial_pagos to authenticated;

-- ---- 2. El perfil del cliente: la comisión no es plata del lote.
create or replace view public.v_clientes
with (security_invoker = true) as
with base as (
  select r.buyer_ci_normalized as ci_norm,
         r.id, r.status, r.created_at, r.confirmed_at, r.client_meta,
         r.buyer_full_name, r.buyer_ci, r.buyer_phone, r.buyer_email, r.project_id
    from public.reservations r
   where coalesce(r.buyer_ci_normalized, '') <> ''
),
ultimo as (
  select distinct on (ci_norm)
         ci_norm, buyer_full_name, buyer_ci, buyer_phone, buyer_email
    from base
   order by ci_norm, created_at desc
)
select u.ci_norm,
       u.buyer_full_name,
       u.buyer_ci,
       u.buyer_phone,
       u.buyer_email,
       count(*) as reservas_totales,
       count(*) filter (where b.status = 'confirmada') as lotes_comprados,
       count(*) filter (where b.status in ('pendiente_pago','en_verificacion','rechazo_reintento'))
         as lotes_reservados,
       count(*) filter (where b.status = 'expirada') as reservas_expiradas,
       count(*) filter (where b.status = 'cancelada') as reservas_canceladas,
       count(*) filter (where b.status = 'cancelada' and b.client_meta ? 'traspasada_a')
         as traspasos_cedidos,
       count(*) filter (where b.status = 'confirmada' and b.client_meta ? 'traspaso')
         as traspasos_recibidos,
       count(distinct b.project_id) as proyectos,
       coalesce(pg.pagado_directo, 0)
         + coalesce(mig.abonado, 0) as pagado_total,
       coalesce(vv.saldo, 0) as saldo_total,
       coalesce(vv.con_plan, 0) as con_plan,
       coalesce(pl.cuotas_vencidas, 0) as cuotas_vencidas,
       coalesce(pl.monto_vencido, 0) as monto_vencido,
       min(b.created_at) as primera_actividad,
       greatest(max(b.created_at), max(pg.ultimo_pago)) as ultima_actividad
  from ultimo u
  join base b on b.ci_norm = u.ci_norm
  left join lateral (
    -- Lo que nos pagó por sus LOTES (señas incluidas: esa plata entró igual).
    -- La comisión del mercado queda fuera: es un servicio, no paga terreno.
    select sum(p.amount_bob) as pagado_directo,
           max(p.verified_at) as ultimo_pago
      from public.payments p
      join base b2 on b2.id = p.reservation_id
     where b2.ci_norm = u.ci_norm and p.status = 'aprobado'
       and p.purpose <> 'comision'
  ) pg on true
  left join lateral (
    select sum((b2.client_meta->'reportado'->>'abonado')::numeric) as abonado
      from base b2
     where b2.ci_norm = u.ci_norm and b2.status = 'confirmada'
       and b2.client_meta ? 'reportado'
  ) mig on true
  left join lateral (
    select sum(v.saldo) as saldo, count(*) filter (where v.con_plan) as con_plan
      from public.v_ventas v
      join base b2 on b2.id = v.reservation_id
     where b2.ci_norm = u.ci_norm
  ) vv on true
  left join lateral (
    select sum(p.cuotas_vencidas) as cuotas_vencidas, sum(p.monto_vencido) as monto_vencido
      from public.v_planes p
     where private.normalize_ci(p.buyer_ci) = u.ci_norm and p.estado = 'activo'
  ) pl on true
 group by u.ci_norm, u.buyer_full_name, u.buyer_ci, u.buyer_phone, u.buyer_email,
          pg.pagado_directo, mig.abonado, vv.saldo, vv.con_plan,
          pl.cuotas_vencidas, pl.monto_vencido, pg.ultimo_pago;

grant select on public.v_clientes to authenticated;

-- ---- 3. El libro: la comisión entra a caja y se abona a 4211 (ingreso
--         propio), nunca a la cuenta por cobrar del lote ni a anticipos.
create or replace view public.v_libro_diario as
with base_venta as (
  select r.*,
         case
           when r.client_meta ? 'migrado_de'
             then coalesce((r.client_meta->'reportado'->>'deuda')::numeric, r.price_agreed)
           when r.client_meta ? 'traspaso'
             then coalesce((r.client_meta->'traspaso'->>'baseline_original')::numeric, r.price_agreed)
           else r.price_agreed
         end as monto_venta,
         (r.status = 'confirmada' or r.client_meta ? 'traspasada_a') as cadena_viva
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
         when p.purpose = 'reserva' then '2131'
         when b.cadena_viva then '1131'
         else '2131'
       end,
       0::numeric, p.amount_bob,
       p.id, 'pago'
  from public.payments p
  join base_venta b on b.id = p.reservation_id
  join public.reservations r on r.id = p.reservation_id
 where p.status = 'aprobado' and p.verified_at is not null
union all
select e.project_id,
       e.incurred_on,
       'EGR-' || left(replace(e.id::text, '-', ''), 10),
       e.description || coalesce(' — ' || coalesce(c.name, e.supplier), ''),
       case e.category
         when 'obra' then '5111'
         when 'comisiones' then '5211'
         when 'sueldos' then '5221'
         when 'publicidad' then '5311'
         when 'administracion' then '5411'
         when 'impuestos' then '5511'
         when 'financiero' then '5611'
         else '5911'
       end,
       e.amount_bob, 0::numeric,
       e.id, 'egreso'
  from public.expenses e
  left join public.contacts c on c.id = e.contact_id
 where e.deleted_at is null
union all
select e.project_id,
       e.incurred_on,
       'EGR-' || left(replace(e.id::text, '-', ''), 10),
       e.description || coalesce(' — ' || coalesce(c.name, e.supplier), ''),
       coalesce(t.account_code, '1111'),
       0::numeric, e.amount_bob,
       e.id, 'egreso'
  from public.expenses e
  left join public.treasury_accounts t on t.id = e.treasury_account_id
  left join public.contacts c on c.id = e.contact_id
 where e.deleted_at is null
union all
select je.project_id,
       je.entry_date,
       je.number,
       je.glosa || coalesce(' — ' || jl.glosa, ''),
       jl.account_code,
       jl.debe, jl.haber,
       je.id, 'comprobante'
  from public.journal_entries je
  join public.journal_lines jl on jl.entry_id = je.id
 where je.status = 'registrado';
