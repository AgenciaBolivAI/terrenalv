-- Un cobro puede llegar en dólares, al cambio DE HOY.
--
-- El negocio es en bolivianos —los precios, los saldos y los libros no se
-- mueven de Bs— pero en el mostrador aparecen dólares, y el cambio real del
-- día no siempre es el que quedó configurado en settings. Si la conversión
-- usara siempre el configurado, el recibo diría una cifra distinta de la que
-- el comprador entregó, y la diferencia quedaría flotando sin dueño.
--
-- Así que el cobro registra: en qué moneda entró, y a qué cambio se convirtió.
-- El asiento, el saldo y el desglose siguen todos en Bs (amount_bob).

drop function if exists public.admin_register_cuota_payment(
  uuid, numeric, date, public.payment_provider_kind, text, text, uuid);

create function public.admin_register_cuota_payment(
  p_reservation_id uuid,
  p_amount numeric,
  p_paid_on date default null,
  p_provider public.payment_provider_kind default 'efectivo',
  p_reference text default null,
  p_note text default null,
  p_treasury_account_id uuid default null,
  p_currency char(3) default null,
  p_exchange_rate numeric default null
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
  v_cur char(3);
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

  v_cur := upper(coalesce(nullif(btrim(coalesce(p_currency, '')), ''), 'BOB'));
  if v_cur not in ('BOB', 'USD') then raise exception 'INVALID_CURRENCY'; end if;

  select * into v_res from public.reservations where id = p_reservation_id;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;

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

  -- El cambio manda en este orden: el que se teclea (el del día), el
  -- configurado, y 6,96 de último recurso. Con límites: un cambio de 0,69 o de
  -- 69 es un dedo resbalado, no un mercado.
  v_rate := coalesce(p_exchange_rate,
                     (private.get_setting(v_res.project_id, 'exchange_rate_bob_per_usd'))::numeric,
                     6.96);
  if v_cur = 'USD' and (v_rate < 1 or v_rate > 100) then
    raise exception 'INVALID_EXCHANGE_RATE';
  end if;

  v_amount_bob := case when v_cur = 'BOB' then p_amount else round(p_amount * v_rate, 2) end;

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
        (v_res.project_id, v_res.id, p_provider, v_ref, v_purpose, p_amount, v_cur,
         v_amount_bob, v_rate, 'aprobado', v_actor,
         coalesce(p_paid_on::timestamptz, now()), p_note, p_treasury_account_id)
      returning id into v_pay_id;
      exit;
    exception when unique_violation then
      if v_try >= 3 or nullif(btrim(coalesce(p_reference, '')), '') is not null then raise; end if;
    end;
  end loop;

  -- La cascada imputa en BOLIVIANOS: las cuotas están en Bs, y un pago en
  -- dólares vale lo que vale convertido — imputar los $us nominales pagaría
  -- 500 cuando entraron 3.480.
  if v_purpose = 'cuota' then
    v_left := v_amount_bob;
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
    null, jsonb_build_object('payment_id', v_pay_id, 'monto', p_amount, 'moneda', v_cur,
                             'cambio', v_rate, 'monto_bob', v_amount_bob, 'tipo', v_purpose,
                             'forma', p_provider,
                             'aplicado', v_applied, 'sobrante', v_left, 'cuotas', v_cuotas));

  return jsonb_build_object(
    'payment_id', v_pay_id, 'reference_code', v_ref, 'tipo', v_purpose,
    'moneda', v_cur, 'cambio', v_rate, 'monto_bob', v_amount_bob,
    'aplicado', v_applied, 'sobrante', coalesce(v_left, 0), 'cuotas_afectadas', v_cuotas);
end;
$fn$;

revoke execute on function public.admin_register_cuota_payment(
  uuid, numeric, date, public.payment_provider_kind, text, text, uuid, char, numeric)
  from public, anon;
grant execute on function public.admin_register_cuota_payment(
  uuid, numeric, date, public.payment_provider_kind, text, text, uuid, char, numeric)
  to authenticated, service_role;

-- El tipo de cambio configurado, para prellenar el campo en el diálogo: la
-- persona lo ve y lo corrige al del día si hace falta.
create or replace function public.get_exchange_rate(p_project_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, private, extensions, pg_temp
as $$
  select coalesce((private.get_setting(p_project_id, 'exchange_rate_bob_per_usd'))::numeric, 6.96);
$$;

revoke execute on function public.get_exchange_rate(uuid) from public, anon;
grant execute on function public.get_exchange_rate(uuid) to authenticated, service_role;
