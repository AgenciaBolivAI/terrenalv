-- Abonos: cobrar a un comprador que no tiene plan de cuotas cargado.
--
-- Las 1.463 ventas migradas del sistema anterior no tienen plan (la fuente no
-- trae el cronograma y sus totales no cierran), y admin_register_cuota_payment
-- moría con NO_ACTIVE_PLAN. O sea: uno de esos compradores venía a pagar al
-- mostrador y contabilidad NO PODÍA registrarle el pago. Ese es exactamente el
-- caso más común de la oficina hoy.
--
-- Un pago sin plan es un ABONO: reduce el saldo del lote sin imputarse a una
-- cuota. Cuando el comprador sí tiene plan activo, todo sigue igual (cascada
-- desde la cuota más vieja).

alter table public.payments drop constraint if exists payments_purpose_check;
alter table public.payments add constraint payments_purpose_check
  check (purpose = any (array['reserva'::text, 'cuota'::text, 'abono'::text]));

drop function if exists public.admin_register_cuota_payment(
  uuid, numeric, date, public.payment_provider_kind, text, text, uuid);

create function public.admin_register_cuota_payment(
  p_reservation_id uuid,
  p_amount numeric,
  p_paid_on date default null,
  p_provider public.payment_provider_kind default 'efectivo',
  p_reference text default null,
  p_note text default null,
  p_treasury_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid;
  v_res public.reservations%rowtype;
  v_plan public.installment_plans%rowtype;
  v_project public.projects%rowtype;
  v_mz_code text;
  v_lot_number text;
  v_rate numeric(10,4);
  v_amount_bob numeric(12,2);
  v_pay_id uuid;
  v_ref text;
  v_left numeric(12,2);
  v_take numeric(12,2);
  v_applied numeric(12,2) := 0;
  v_cuotas int := 0;
  v_row record;
  v_try int := 0;
  v_purpose text;
begin
  v_actor := private.assert_accounting();

  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  select * into v_res from public.reservations where id = p_reservation_id;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;

  -- Con plan activo es una cuota; sin plan es un abono. Antes acá moría con
  -- NO_ACTIVE_PLAN y el pago del mostrador quedaba sin registrar.
  select * into v_plan from public.installment_plans
   where reservation_id = p_reservation_id and status = 'activo';
  v_purpose := case when found then 'cuota' else 'abono' end;

  if p_treasury_account_id is not null
     and not exists (select 1 from public.treasury_accounts
                      where id = p_treasury_account_id and is_active) then
    raise exception 'TREASURY_NOT_FOUND';
  end if;

  select * into v_project from public.projects where id = v_res.project_id;
  select m.code, l.number into v_mz_code, v_lot_number
    from public.lots l join public.manzanas m on m.id = l.manzana_id
   where l.id = v_res.lot_id;

  v_rate := coalesce((private.get_setting(v_res.project_id, 'exchange_rate_bob_per_usd'))::numeric, 6.96);
  v_amount_bob := case when v_res.currency = 'BOB' then p_amount
                       else round(p_amount * v_rate, 2) end;

  loop
    v_try := v_try + 1;
    v_ref := coalesce(nullif(btrim(coalesce(p_reference, '')), ''),
                      v_project.tracking_prefix || '-C-' || replace(coalesce(v_mz_code, ''), '-', '')
                      || '-' || coalesce(v_lot_number, '') || '-' || private.gen_code(4));
    begin
      insert into public.payments
        (project_id, reservation_id, provider, reference_code, purpose, amount, currency,
         amount_bob, exchange_rate_used, status, verified_by, verified_at, rejection_note,
         treasury_account_id)
      values
        (v_res.project_id, v_res.id, p_provider, v_ref, v_purpose, p_amount, v_res.currency,
         v_amount_bob, v_rate, 'aprobado', v_actor,
         coalesce(p_paid_on::timestamptz, now()), p_note, p_treasury_account_id)
      returning id into v_pay_id;
      exit;
    exception when unique_violation then
      if v_try >= 3 or nullif(btrim(coalesce(p_reference, '')), '') is not null then raise; end if;
    end;
  end loop;

  -- La cascada solo aplica cuando hay cuotas que imputar.
  if v_purpose = 'cuota' then
    v_left := p_amount;
    for v_row in
      select id, amount - amount_paid as falta
        from public.installments
       where plan_id = v_plan.id and status in ('pendiente', 'parcial')
       order by number
    loop
      exit when v_left <= 0;
      v_take := least(v_left, v_row.falta);
      if v_take > 0 then
        insert into public.payment_allocations (payment_id, installment_id, amount)
        values (v_pay_id, v_row.id, v_take);
        v_left := round(v_left - v_take, 2);
        v_applied := round(v_applied + v_take, 2);
        v_cuotas := v_cuotas + 1;
      end if;
    end loop;
  end if;

  perform private.audit('team', v_actor, null,
    case when v_purpose = 'cuota' then 'cuota.registered' else 'abono.registered' end,
    v_res.project_id, 'reservation', v_res.id,
    null, jsonb_build_object('payment_id', v_pay_id, 'monto', p_amount, 'tipo', v_purpose,
                             'forma', p_provider,
                             'aplicado', v_applied, 'sobrante', v_left, 'cuotas', v_cuotas));

  return jsonb_build_object(
    'payment_id', v_pay_id, 'reference_code', v_ref, 'tipo', v_purpose,
    'aplicado', v_applied, 'sobrante', coalesce(v_left, 0), 'cuotas_afectadas', v_cuotas);
end;
$fn$;

revoke execute on function public.admin_register_cuota_payment(
  uuid, numeric, date, public.payment_provider_kind, text, text, uuid) from public, anon;
grant execute on function public.admin_register_cuota_payment(
  uuid, numeric, date, public.payment_provider_kind, text, text, uuid)
  to authenticated, service_role;

-- El libro nombra el abono como lo que es.
create or replace view public.v_libro_diario
with (security_invoker = true) as
select r.project_id,
       (r.confirmed_at at time zone 'America/La_Paz')::date as fecha,
       'VTA-' || r.tracking_code as comprobante,
       'Venta de lote — ' || r.buyer_full_name as glosa,
       '1131'::text as cuenta, r.price_agreed as debe, 0::numeric as haber,
       r.id as origen_id, 'venta'::text as origen
  from public.reservations r where r.confirmed_at is not null
union all
select r.project_id,
       (r.confirmed_at at time zone 'America/La_Paz')::date,
       'VTA-' || r.tracking_code,
       'Venta de lote — ' || r.buyer_full_name,
       '4111', 0::numeric, r.price_agreed, r.id, 'venta'
  from public.reservations r where r.confirmed_at is not null
union all
select p.project_id,
       (p.verified_at at time zone 'America/La_Paz')::date,
       'PAGO-' || p.reference_code,
       (case p.purpose when 'cuota' then 'Cobro de cuota'
                       when 'abono' then 'Abono al lote'
                       else 'Cobro de seña / reserva' end)
         || ' por ' || private.forma_de_pago(p.provider)
         || ' — ' || r.buyer_full_name || ' (' || r.tracking_code || ')',
       coalesce(t.account_code, '1111'), p.amount_bob, 0::numeric, p.id, 'pago'
  from public.payments p
  join public.reservations r on r.id = p.reservation_id
  left join public.treasury_accounts t on t.id = p.treasury_account_id
 where p.status = 'aprobado' and p.verified_at is not null
union all
select p.project_id,
       (p.verified_at at time zone 'America/La_Paz')::date,
       'PAGO-' || p.reference_code,
       (case p.purpose when 'cuota' then 'Cobro de cuota'
                       when 'abono' then 'Abono al lote'
                       else 'Cobro de seña / reserva' end)
         || ' por ' || private.forma_de_pago(p.provider)
         || ' — ' || r.buyer_full_name || ' (' || r.tracking_code || ')',
       case when r.confirmed_at is not null then '1131' else '2131' end,
       0::numeric, p.amount_bob, p.id, 'pago'
  from public.payments p
  join public.reservations r on r.id = p.reservation_id
 where p.status = 'aprobado' and p.verified_at is not null
union all
select e.project_id, e.incurred_on,
       'EGR-' || left(replace(e.id::text, '-', ''), 10),
       e.description || coalesce(' — ' || coalesce(c.name, e.supplier), ''),
       case e.category
         when 'obra'           then '5111' when 'comisiones'     then '5211'
         when 'sueldos'        then '5221' when 'publicidad'     then '5311'
         when 'administracion' then '5411' when 'impuestos'      then '5511'
         when 'financiero'     then '5611' else '5911' end,
       e.amount_bob, 0::numeric, e.id, 'egreso'
  from public.expenses e
  left join public.contacts c on c.id = e.contact_id
 where e.deleted_at is null
union all
select e.project_id, e.incurred_on,
       'EGR-' || left(replace(e.id::text, '-', ''), 10),
       e.description || coalesce(' — ' || coalesce(c.name, e.supplier), ''),
       coalesce(t.account_code, '1111'), 0::numeric, e.amount_bob, e.id, 'egreso'
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

-- ============================================================ VENTAS
-- Una fila por venta confirmada, con lo cobrado y el saldo. Es la vista de la
-- página de Ventas y del estado unificado: cuotas y abonos juntos.
--
-- El saldo de una venta migrada parte de la deuda que REPORTABA el sistema
-- anterior (client_meta.reportado.deuda) y se reduce con los pagos registrados
-- acá; el de una venta nativa parte del precio pactado. Los dos disminuyen
-- igual con cada cobro.
create or replace view public.v_ventas
with (security_invoker = true) as
select r.project_id,
       r.id as reservation_id,
       r.tracking_code,
       r.buyer_full_name,
       r.buyer_ci,
       r.buyer_phone,
       r.buyer_email,
       (r.confirmed_at at time zone 'America/La_Paz')::date as fecha_venta,
       r.price_agreed,
       r.currency,
       m.code as manzana,
       l.number as lote,
       p.name as proyecto,
       (r.client_meta ? 'migrado_de') as migrada,
       coalesce((r.client_meta->'reportado'->>'deuda')::numeric, null) as deuda_migrada,
       coalesce(pg.total, 0) as cobrado_aqui,
       coalesce(pg.cuotas, 0) as pagos_cuota,
       coalesce(pg.abonos, 0) as pagos_abono,
       greatest(0, coalesce((r.client_meta->'reportado'->>'deuda')::numeric, r.price_agreed)
                   - coalesce(pg.total, 0)) as saldo,
       exists (select 1 from public.installment_plans ip
                where ip.reservation_id = r.id and ip.status = 'activo') as con_plan,
       pg.ultimo_pago
  from public.reservations r
  join public.projects p on p.id = r.project_id
  left join public.lots l on l.id = r.lot_id
  left join public.manzanas m on m.id = l.manzana_id
  left join lateral (
    select sum(x.amount_bob) as total,
           count(*) filter (where x.purpose = 'cuota') as cuotas,
           count(*) filter (where x.purpose = 'abono') as abonos,
           max((x.verified_at at time zone 'America/La_Paz')::date) as ultimo_pago
      from public.payments x
     where x.reservation_id = r.id and x.status = 'aprobado' and x.purpose <> 'reserva'
  ) pg on true
 where r.status = 'confirmada';

grant select on public.v_ventas to authenticated;
