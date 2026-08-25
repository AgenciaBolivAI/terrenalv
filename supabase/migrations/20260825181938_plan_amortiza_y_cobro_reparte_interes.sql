-- El plan amortiza de verdad y el cobro reparte capital / interés.
--
-- Sistema francés sobre saldo: cuota fija, y dentro de cada cuota el interés
-- del mes sobre lo que todavía se debe. Cada cuota queda escrita con su
-- desglose, y al cobrarla el interés se cobra PRIMERO (como en cualquier
-- crédito) y el resto baja el capital.

-- ---- 1. Crear el plan: amortización real.
create or replace function public.admin_create_installment_plan(
  p_reservation_id uuid,
  p_months int,
  p_monthly_amount numeric,
  p_down_payment numeric default 0,
  p_first_due_date date default null,
  p_annual_interest_pct numeric default 0,
  p_note text default null,
  p_monthly_interest_pct numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid;
  v_res public.reservations%rowtype;
  v_plan_id uuid;
  v_saldo numeric(12,2);
  v_financed numeric(12,2);
  v_first date;
  v_i int;
  v_tasa numeric;
  v_cuota numeric(12,2);
  v_interes numeric(12,2);
  v_capital numeric(12,2);
  v_pend numeric(12,2);
  v_cond jsonb;
begin
  v_actor := private.assert_accounting();

  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if v_res.status <> 'confirmada' then raise exception 'RESERVATION_NOT_CONFIRMED'; end if;
  if p_months is null or p_months < 1 or p_months > 480 then raise exception 'INVALID_MONTHS'; end if;
  if coalesce(p_down_payment, 0) < 0 then raise exception 'INVALID_DOWN_PAYMENT'; end if;

  -- El saldo REAL: precio (o deuda reportada) menos el capital ya pagado —
  -- seña incluida, que para eso se aplicó al precio.
  v_saldo := greatest(0, private.base_del_lote(p_reservation_id)
                        - private.capital_pagado(p_reservation_id));
  if coalesce(p_down_payment, 0) > v_saldo then raise exception 'DOWN_PAYMENT_OVER_PRICE'; end if;
  v_financed := round(v_saldo - coalesce(p_down_payment, 0), 2);
  if v_financed <= 0 then raise exception 'NOTHING_TO_FINANCE'; end if;

  -- El interés: el que indique quien crea el plan; si no indica nada, el que
  -- manda la clasificación del lote por su precio.
  if p_monthly_interest_pct is null then
    v_cond := public.condiciones_financiamiento(v_res.project_id, v_res.price_agreed);
    v_tasa := coalesce((v_cond->>'interes_mensual_pct')::numeric, 0);
  else
    v_tasa := p_monthly_interest_pct;
  end if;
  if v_tasa < 0 or v_tasa > 20 then raise exception 'INTERES_INVALIDO'; end if;

  if v_tasa > 0 then
    -- Cuota fija del sistema francés. La manda la matemática, no el teclado:
    -- con interés, una cuota escrita a mano deja la última cuota absurda.
    v_cuota := round(v_financed * (v_tasa/100)
                     / (1 - power(1 + v_tasa/100, -p_months)), 2);
  else
    v_cuota := coalesce(nullif(p_monthly_amount, 0), ceil(v_financed / p_months * 100) / 100);
    if v_cuota <= 0 then raise exception 'INVALID_MONTHLY'; end if;
    if round(v_cuota * (p_months - 1), 2) >= v_financed then
      raise exception 'INVALID_MONTHLY'
        using detail = format('con %s de cuota el financiado %s se paga antes de %s meses',
                              v_cuota, v_financed, p_months);
    end if;
  end if;

  v_first := coalesce(p_first_due_date, (current_date + interval '1 month')::date);

  insert into public.installment_plans
    (project_id, reservation_id, total_price, base_amount, currency, down_payment,
     financed_amount, months, monthly_amount, annual_interest_pct, monthly_interest_pct,
     first_due_date, note, created_by)
  values
    (v_res.project_id, v_res.id, v_res.price_agreed, v_saldo, v_res.currency,
     coalesce(p_down_payment, 0), v_financed, p_months, v_cuota,
     coalesce(p_annual_interest_pct, 0), v_tasa, v_first, p_note, v_actor)
  returning id into v_plan_id;

  v_pend := v_financed;
  for v_i in 1..p_months loop
    if v_tasa > 0 then
      v_interes := round(v_pend * v_tasa / 100, 2);
      v_capital := case when v_i < p_months then round(v_cuota - v_interes, 2) else v_pend end;
    else
      v_interes := 0;
      v_capital := case when v_i < p_months then v_cuota else v_pend end;
    end if;
    v_pend := round(v_pend - v_capital, 2);
    insert into public.installments
      (plan_id, project_id, number, due_date, amount, interes, currency)
    values
      (v_plan_id, v_res.project_id, v_i,
       (v_first + (v_i - 1) * interval '1 month')::date,
       round(v_capital + v_interes, 2), v_interes, v_res.currency);
  end loop;

  perform private.audit('team', v_actor, null, 'plan.created', v_res.project_id,
    'reservation', v_res.id, null,
    jsonb_build_object('plan_id', v_plan_id, 'meses', p_months, 'cuota', v_cuota,
                       'financiado', v_financed, 'base', v_saldo,
                       'interes_mensual', v_tasa, 'inicial', coalesce(p_down_payment, 0)));

  return jsonb_build_object('plan_id', v_plan_id, 'financed_amount', v_financed,
                            'base_amount', v_saldo, 'monthly_amount', v_cuota,
                            'monthly_interest_pct', v_tasa, 'first_due_date', v_first,
                            'total_a_pagar', (select round(sum(amount),2) from public.installments
                                               where plan_id = v_plan_id),
                            'intereses_totales', (select round(sum(interes),2) from public.installments
                                                   where plan_id = v_plan_id));
end;
$fn$;

revoke execute on function public.admin_create_installment_plan(
  uuid, int, numeric, numeric, date, numeric, text, numeric) from public, anon;
grant execute on function public.admin_create_installment_plan(
  uuid, int, numeric, numeric, date, numeric, text, numeric) to authenticated, service_role;

-- ---- 2. El traspaso arrastra el capital REAL (seña incluida).
do $patch$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='admin_traspasar_venta';
  if position('capital_pagado' in v_def) > 0 then return; end if;
  v_def := replace(v_def,
    $$  select coalesce(sum(x.amount_bob), 0) into v_pagado
    from public.payments x
   where x.reservation_id = p_reservation_id
     and x.status = 'aprobado' and x.purpose in ('cuota','abono');
  v_saldo := greatest(0,
    coalesce((v_vieja.client_meta->'reportado'->>'deuda')::numeric, v_vieja.price_agreed)
    - v_pagado);$$,
    $$  -- El capital pagado del lote: cuotas, abonos y la seña, que se aplicó al
  -- precio. Una definición común para que el arrastre coincida al centavo
  -- con lo que la pantalla venía mostrando.
  v_pagado := private.capital_pagado(p_reservation_id);
  v_saldo := greatest(0, private.base_del_lote(p_reservation_id) - v_pagado);$$);
  if position('capital_pagado' in v_def) = 0 then
    raise exception 'PATCH_NO_APLICADO: admin_traspasar_venta';
  end if;
  execute v_def;
end;
$patch$;

-- ---- 3. El dato ya congelado: la cadena EDS-DEMO2 → EDS-BYYA-X5JE se
--         traspasó antes de que la seña contara, así que su arrastre quedó
--         Bs 1.000 corto. Se corrige donde está escrito.
update public.reservations n
   set client_meta = jsonb_set(
         jsonb_set(n.client_meta, '{reportado,abonado}',
                   to_jsonb(((n.client_meta->'reportado'->>'abonado')::numeric + s.sena))),
         '{reportado,deuda}',
         to_jsonb(greatest(0, (n.client_meta->'reportado'->>'deuda')::numeric - s.sena))),
       updated_at = now()
  from (
    select (v.client_meta->'traspasada_a'->>'reservation')::uuid as sucesor,
           coalesce(sum(p.amount_bob), 0) as sena
      from public.reservations v
      join public.payments p on p.reservation_id = v.id
                            and p.purpose = 'reserva' and p.status = 'aprobado'
     where v.client_meta ? 'traspasada_a'
     group by 1
  ) s
 where n.id = s.sucesor
   and s.sena > 0
   and n.client_meta ? 'reportado'
   -- Solo si todavía no se corrigió (idempotente).
   and not (n.client_meta->'traspaso' ? 'sena_incorporada');

update public.reservations n
   set client_meta = jsonb_set(n.client_meta, '{traspaso,sena_incorporada}', 'true'::jsonb)
 where n.client_meta ? 'traspaso'
   and not (n.client_meta->'traspaso' ? 'sena_incorporada')
   and exists (select 1 from public.payments p
                where p.reservation_id = (n.client_meta->'traspaso'->>'de_reservation')::uuid
                  and p.purpose = 'reserva' and p.status = 'aprobado');
