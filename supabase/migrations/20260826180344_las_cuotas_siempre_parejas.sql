-- Las cuotas van SIEMPRE parejas. Regla de la casa, dicha por el dueño.
--
-- Hasta hoy, tres funciones armaban cronogramas y las tres dejaban la última
-- cuota como «lo que sobró»: crear un plan, reprogramarlo, y abonar a capital.
-- Con divisiones exactas no se notaba; con un ajuste de por medio quedaban
-- planes de 7 cuotas de 5.156,25 y una de 4.156,25 — mil pesos de diferencia
-- entre una cuota y la siguiente, imposible de explicarle al comprador.
--
-- Desde ahora, para planes sin interés: el capital se reparte IGUAL entre
-- todas las cuotas. La única variación permitida es de centavos en la última,
-- cuando la división no da exacta (100/3 no existe en centavos). Si quien
-- edita fija una cuota a mano, esa cuota elige el plazo más cercano y el
-- sistema empareja: dos cuotas distintas en un mismo cronograma ya no salen
-- de ninguna función. Con interés, el sistema francés ya las hace iguales.
--
-- De paso: abonar a capital regeneraba cuotas sin emparejar la numeración —
-- el mismo salto del 1 al 13 que ya se arregló en reprogramar. Ahora también
-- renumera.

-- ---------- 1. crear un plan ----------------------------------------------
create or replace function public.admin_create_installment_plan(
  p_reservation_id uuid, p_months integer, p_monthly_amount numeric,
  p_down_payment numeric default 0, p_first_due_date date default null,
  p_annual_interest_pct numeric default 0, p_note text default null,
  p_monthly_interest_pct numeric default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $function$
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
    -- Cuotas parejas: el financiado se reparte igual entre los meses. La
    -- cuota tipeada no manda — dos cuotas distintas en un plan ya no existen.
    -- Solo la última puede variar por centavos, si la división no da exacta.
    v_cuota := round(v_financed / p_months, 2);
    if v_cuota <= 0 or round(v_financed - v_cuota * (p_months - 1), 2) <= 0 then
      raise exception 'INVALID_MONTHS'
        using detail = format('%s meses para %s deja cuotas de centavos', p_months, v_financed);
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
$function$;

-- ---------- 2. reprogramar un plan -----------------------------------------
create or replace function public.admin_editar_plan(
  p_plan_id uuid,
  p_interes_mensual numeric default null,
  p_meses integer default null,
  p_cuota numeric default null,
  p_primera_fecha date default null,
  p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $function$
declare
  v_actor uuid;
  v_plan public.installment_plans%rowtype;
  v_antes jsonb;
  v_pendiente numeric(14,2);
  v_tasa numeric;
  v_meses int;
  v_cuota numeric(12,2);
  v_next date;
  v_num int;
  v_i int;
  v_interes numeric(12,2);
  v_capital numeric(12,2);
  v_pend numeric(12,2);
begin
  v_actor := private.assert_accounting();

  select * into v_plan from public.installment_plans where id = p_plan_id for update;
  if not found then raise exception 'PLAN_NO_ENCONTRADO'; end if;
  if v_plan.status <> 'activo' then
    raise exception 'PLAN_NO_ACTIVO'
      using detail = 'Solo se edita un plan vigente.';
  end if;

  v_antes := jsonb_build_object(
    'interes', v_plan.monthly_interest_pct, 'meses', v_plan.months,
    'cuota', v_plan.monthly_amount, 'primera', v_plan.first_due_date);

  v_tasa := coalesce(p_interes_mensual, v_plan.monthly_interest_pct, 0);
  if v_tasa < 0 or v_tasa > 20 then raise exception 'INTERES_INVALIDO'; end if;

  -- El capital que falta se pregunta a la DEUDA, no al cronograma: precio (o
  -- deuda reportada) menos capital pagado, seña incluida.
  v_pendiente := greatest(0, private.base_del_lote(v_plan.reservation_id)
                           - private.capital_pagado(v_plan.reservation_id));

  if v_pendiente <= 0.01 then
    raise exception 'NADA_QUE_REPROGRAMAR'
      using detail = 'Este plan ya no tiene capital pendiente.';
  end if;

  -- El plazo: o lo fijan, o lo elige la cuota deseada (el plazo que más se le
  -- acerca), o se conserva el que había. La cuota tipeada NUNCA queda tal
  -- cual: elige el plazo, y después el sistema empareja todas las cuotas.
  if p_cuota is not null then
    if p_cuota <= 0 then raise exception 'INVALID_MONTHLY'; end if;
    if v_tasa > 0 and p_cuota <= round(v_pendiente * v_tasa / 100, 2) then
      raise exception 'CUOTA_NO_CUBRE_INTERES'
        using detail = format('con %s de saldo, el interés del mes es %s',
                              v_pendiente, round(v_pendiente * v_tasa / 100, 2));
    end if;
    v_meses := case when v_tasa > 0
                    then greatest(1, round(ln(p_cuota / (p_cuota - v_pendiente * v_tasa / 100))
                                          / ln(1 + v_tasa / 100))::int)
                    else greatest(1, round(v_pendiente / p_cuota)::int) end;
  elsif p_meses is not null then
    if p_meses < 1 or p_meses > 480 then raise exception 'INVALID_MONTHS'; end if;
    v_meses := p_meses;
  else
    select count(*) into v_meses from public.installments
     where plan_id = p_plan_id and status in ('pendiente','parcial');
    v_meses := greatest(1, v_meses);
  end if;

  -- La cuota, SIEMPRE pareja para el plazo elegido: francesa con interés,
  -- reparto igual sin él. Solo la última puede variar por centavos.
  if v_tasa > 0 then
    v_cuota := round(v_pendiente * (v_tasa/100) / (1 - power(1 + v_tasa/100, -v_meses)), 2);
  else
    v_cuota := round(v_pendiente / v_meses, 2);
    if v_cuota <= 0 or round(v_pendiente - v_cuota * (v_meses - 1), 2) <= 0 then
      raise exception 'INVALID_MONTHS'
        using detail = format('%s cuotas para %s deja cuotas de centavos', v_meses, v_pendiente);
    end if;
  end if;

  if p_primera_fecha is not null then
    v_next := p_primera_fecha;
  else
    select min(due_date) into v_next from public.installments
     where plan_id = p_plan_id and status in ('pendiente','parcial');
    v_next := coalesce(v_next, (current_date + interval '1 month')::date);
  end if;

  update public.installments set status = 'anulada', updated_at = now()
   where plan_id = p_plan_id and status in ('pendiente','parcial');

  select coalesce(max(number), 0) into v_num from public.installments where plan_id = p_plan_id;
  v_pend := v_pendiente;
  for v_i in 1..v_meses loop
    if v_tasa > 0 then
      v_interes := round(v_pend * v_tasa / 100, 2);
      v_capital := case when v_i < v_meses then round(v_cuota - v_interes, 2) else v_pend end;
    else
      v_interes := 0;
      v_capital := case when v_i < v_meses then v_cuota else v_pend end;
    end if;
    v_pend := round(v_pend - v_capital, 2);
    v_num := v_num + 1;
    insert into public.installments
      (plan_id, project_id, number, due_date, amount, interes, currency)
    values
      (p_plan_id, v_plan.project_id, v_num,
       (v_next + (v_i - 1) * interval '1 month')::date,
       round(v_capital + v_interes, 2), v_interes, v_plan.currency);
  end loop;

  perform private.renumerar_cuotas(p_plan_id);

  update public.installment_plans
     set monthly_interest_pct = v_tasa,
         months = v_meses,
         monthly_amount = v_cuota,
         financed_amount = (select round(sum(i.amount - i.interes), 2)
                              from public.installments i
                             where i.plan_id = p_plan_id and i.status <> 'anulada'),
         first_due_date = least(first_due_date, v_next),
         note = coalesce(note || ' · ', '') || 'plan reprogramado',
         updated_at = now()
   where id = p_plan_id;

  perform private.audit('team', v_actor, null, 'plan.editado', v_plan.project_id,
    'reservation', v_plan.reservation_id, v_antes,
    jsonb_build_object('interes', v_tasa, 'meses', v_meses, 'cuota', v_cuota,
                       'desde', v_next, 'capital_reprogramado', v_pendiente,
                       'nota', p_note));

  return jsonb_build_object('ok', true, 'interes_mensual', v_tasa, 'meses', v_meses,
                            'cuota', v_cuota, 'desde', v_next,
                            'capital_reprogramado', v_pendiente);
end;
$function$;
