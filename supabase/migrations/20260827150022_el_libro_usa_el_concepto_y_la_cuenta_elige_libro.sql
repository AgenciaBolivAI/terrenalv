-- 1) El libro cuelga el egreso de la cuenta del CONCEPTO cuando hay uno.
--    Sin concepto, sigue mandando la familia de siempre: las cargas viejas
--    no se mueven de lugar.
--
-- 2) Cada cuenta de tesorería dice a qué libro pertenece.
--    Ojo con la palabra: TODO está siempre en el gerencial, que es la verdad
--    del negocio. Marcar una cuenta como «fiscal» significa que lo que pasa
--    por ella se declara; marcarla «gerencial» significa que no entra sola a
--    la importación. Es un dato de la cuenta, igual que el titular — el
--    gerencial no nombra al módulo fiscal por eso.

alter table public.treasury_accounts
  add column if not exists ambito text not null default 'gerencial';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'treasury_accounts_ambito_check') then
    alter table public.treasury_accounts add constraint treasury_accounts_ambito_check
      check (ambito in ('gerencial','fiscal'));
  end if;
end $$;

comment on column public.treasury_accounts.ambito is
  'gerencial = lo que pasa por esta cuenta no se declara solo; fiscal = sí. '
  'Todo está siempre en el libro gerencial: esto decide qué se propone declarar.';

-- ---------- el libro, con la cuenta del concepto -----------------------------
create or replace view public.v_libro_diario as
 with base_venta as (
   select r.*,
     case
       when r.client_meta ? 'migrado_de' then coalesce(((r.client_meta -> 'reportado') ->> 'deuda')::numeric, r.price_agreed)
       when r.client_meta ? 'traspaso' then coalesce(((r.client_meta -> 'traspaso') ->> 'baseline_original')::numeric, r.price_agreed)
       else r.price_agreed
     end as monto_venta,
     r.status = 'confirmada'::reservation_status or r.client_meta ? 'traspasada_a' as cadena_viva,
     r.status = any (array['pendiente_pago'::reservation_status,'en_verificacion'::reservation_status,'rechazo_reintento'::reservation_status]) as reserva_viva,
     (r.status = any (array['expirada'::reservation_status,'cancelada'::reservation_status])) and not r.client_meta ? 'traspasada_a' as reserva_caida
   from public.reservations r
 )
 select r.project_id,
    (r.confirmed_at at time zone 'America/La_Paz')::date as fecha,
    'VTA-' || r.tracking_code as comprobante,
    'Venta de lote — ' || r.buyer_full_name as glosa,
    '1131'::text as cuenta,
    r.monto_venta as debe, 0::numeric as haber, r.id as origen_id, 'venta'::text as origen,
    r.buyer_ci_normalized as cliente_ci, r.buyer_full_name as cliente,
    null::uuid as centro_costo_id, null::text as centro_costo,
    r.titular, r.titular_nombre
   from base_venta r
  where r.confirmed_at is not null and r.status = 'confirmada'
union all
 select r.project_id, (r.confirmed_at at time zone 'America/La_Paz')::date,
    'VTA-' || r.tracking_code, 'Venta de lote — ' || r.buyer_full_name,
    '4111'::text, 0::numeric, r.monto_venta, r.id, 'venta'::text,
    r.buyer_ci_normalized, r.buyer_full_name, null::uuid, null::text,
    r.titular, r.titular_nombre
   from base_venta r
  where r.confirmed_at is not null and r.status = 'confirmada'
union all
 select p.project_id, (p.verified_at at time zone 'America/La_Paz')::date,
    'PAGO-' || p.reference_code,
    (case p.purpose when 'cuota' then 'Cobro de cuota' when 'abono' then 'Abono al lote'
       when 'comision' then 'Comisión del mercado de traspasos' else 'Cobro de seña / reserva' end
     || ' por ' || private.forma_de_pago(p.provider) || ' — ' || r.buyer_full_name
     || ' (' || r.tracking_code || ')'),
    coalesce(t.account_code, '1111'), p.amount_bob, 0::numeric, p.id, 'pago'::text,
    r.buyer_ci_normalized, r.buyer_full_name, null::uuid, null::text,
    r.titular, r.titular_nombre
   from public.payments p
   join public.reservations r on r.id = p.reservation_id
   left join public.treasury_accounts t on t.id = p.treasury_account_id
  where p.status = 'aprobado' and p.verified_at is not null
union all
 select p.project_id, (p.verified_at at time zone 'America/La_Paz')::date,
    'PAGO-' || p.reference_code,
    (case p.purpose when 'cuota' then 'Cobro de cuota' when 'abono' then 'Abono al lote'
       when 'comision' then 'Comisión del mercado de traspasos' else 'Cobro de seña / reserva' end
     || ' por ' || private.forma_de_pago(p.provider) || ' — ' || r.buyer_full_name
     || ' (' || r.tracking_code || ')'),
    case when p.purpose = 'comision' then '4211'
         when p.purpose = 'reserva' and b.reserva_caida then '4411'
         when b.cadena_viva then '1131' else '2131' end,
    0::numeric, p.amount_bob - coalesce(p.interest_bob, 0), p.id, 'pago'::text,
    r.buyer_ci_normalized, r.buyer_full_name, null::uuid, null::text,
    r.titular, r.titular_nombre
   from public.payments p
   join base_venta b on b.id = p.reservation_id
   join public.reservations r on r.id = p.reservation_id
  where p.status = 'aprobado' and p.verified_at is not null
    and (p.amount_bob - coalesce(p.interest_bob, 0)) <> 0
union all
 select p.project_id, (p.verified_at at time zone 'America/La_Paz')::date,
    'PAGO-' || p.reference_code,
    'Interés de financiamiento — ' || r.buyer_full_name || ' (' || r.tracking_code || ')',
    '4311'::text, 0::numeric, p.interest_bob, p.id, 'pago'::text,
    r.buyer_ci_normalized, r.buyer_full_name, null::uuid, null::text,
    r.titular, r.titular_nombre
   from public.payments p
   join public.reservations r on r.id = p.reservation_id
  where p.status = 'aprobado' and p.verified_at is not null
    and coalesce(p.interest_bob, 0) > 0
union all
 select e.project_id, e.incurred_on,
    'EGR-' || left(replace(e.id::text, '-', ''), 10),
    -- El concepto adelante: «Uniformes — Ferretería El Sur» se lee de un
    -- vistazo; «compra varios» no dice nada tres meses después.
    coalesce(ec.nombre || ' — ', '') || e.description
      || coalesce(' — ' || coalesce(c.name, e.supplier), ''),
    coalesce(ec.account_code,
      case e.category
        when 'obra' then '5111' when 'comisiones' then '5211'
        when 'sueldos' then '5221' when 'publicidad' then '5311'
        when 'administracion' then '5411' when 'impuestos' then '5511'
        when 'financiero' then '5611' else '5911' end),
    e.amount_bob, 0::numeric, e.id, 'egreso'::text,
    rv.buyer_ci_normalized, rv.buyer_full_name,
    e.centro_costo_id, cc.nombre, e.titular, e.titular_nombre
   from public.expenses e
   left join public.contacts c on c.id = e.contact_id
   left join public.reservations rv on rv.id = e.reservation_id
   left join public.centros_costo cc on cc.id = e.centro_costo_id
   left join public.expense_concepts ec on ec.id = e.concept_id
  where e.deleted_at is null
union all
 select e.project_id, e.incurred_on,
    'EGR-' || left(replace(e.id::text, '-', ''), 10),
    coalesce(ec.nombre || ' — ', '') || e.description
      || coalesce(' — ' || coalesce(c.name, e.supplier), ''),
    coalesce(t.account_code, '1111'),
    0::numeric, e.amount_bob, e.id, 'egreso'::text,
    rv.buyer_ci_normalized, rv.buyer_full_name,
    e.centro_costo_id, cc.nombre, e.titular, e.titular_nombre
   from public.expenses e
   left join public.treasury_accounts t on t.id = e.treasury_account_id
   left join public.contacts c on c.id = e.contact_id
   left join public.reservations rv on rv.id = e.reservation_id
   left join public.centros_costo cc on cc.id = e.centro_costo_id
   left join public.expense_concepts ec on ec.id = e.concept_id
  where e.deleted_at is null
union all
 select je.project_id, je.entry_date, je.number,
    je.glosa || coalesce(' — ' || jl.glosa, ''),
    jl.account_code, jl.debe, jl.haber, je.id, 'comprobante'::text,
    rv.buyer_ci_normalized, rv.buyer_full_name,
    je.centro_costo_id, cc.nombre, je.titular, je.titular_nombre
   from public.journal_entries je
   join public.journal_lines jl on jl.entry_id = je.id
   left join public.reservations rv on rv.id = je.reservation_id
   left join public.centros_costo cc on cc.id = je.centro_costo_id
  where je.status = 'registrado';

alter view public.v_libro_diario set (security_invoker = true);
