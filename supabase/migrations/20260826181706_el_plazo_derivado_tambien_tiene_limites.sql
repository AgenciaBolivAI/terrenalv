-- Tres grietas que encontró la verificación adversaria de hoy, cerradas.
--
-- 1. Si alguien tipeaba una cuota ridícula (Bs 10 sobre 40.250), el plazo
--    derivado daba 4.025 meses: la función insertaba las cuatro mil filas y
--    recién ahí moría contra una restricción de la tabla, con un error crudo.
--    El límite de 480 meses ahora vale también para el plazo DERIVADO de una
--    cuota, y avisa en cristiano antes de insertar nada.
--
-- 2. Tras un abono a capital con «mantener cuotas», el conteo ignoraba las
--    cuotas vencidas (due_date >= hoy): un plan con una cuota atrasada perdía
--    esa cuota del conteo y el cronograma nuevo arrancaba DESPUÉS de la
--    vencida — la mora desaparecía en silencio. Ahora cuentan todas las
--    pendientes, y el cronograma nuevo arranca en la fecha más vieja que
--    había, así la mora sigue a la vista.
--
-- 3. El guardián de cuotas parejas ignoraba los planes CON interés. Ahí la
--    última cuota difiere por matemática (el redondeo del sistema francés se
--    capitaliza mes a mes: hasta e·((1+i)^n−1)/i con e ≤ medio centavo), pero
--    «difiere por matemática» tiene una cota — y ahora se vigila contra esa
--    cota, no se mira para otro lado.

-- ---------- 1. reprogramar: límites al plazo derivado ----------------------
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

  v_pendiente := greatest(0, private.base_del_lote(v_plan.reservation_id)
                           - private.capital_pagado(v_plan.reservation_id));

  if v_pendiente <= 0.01 then
    raise exception 'NADA_QUE_REPROGRAMAR'
      using detail = 'Este plan ya no tiene capital pendiente.';
  end if;

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
    -- El plazo que salió de la cuota también respeta el techo del negocio.
    if v_meses > 480 then
      raise exception 'INVALID_MONTHS'
        using detail = format('con esa cuota saldrían %s meses; el máximo es 480 (cuota mínima ~%s)',
                              v_meses, round(v_pendiente / 480, 2));
    end if;
  elsif p_meses is not null then
    if p_meses < 1 or p_meses > 480 then raise exception 'INVALID_MONTHS'; end if;
    v_meses := p_meses;
  else
    select count(*) into v_meses from public.installments
     where plan_id = p_plan_id and status in ('pendiente','parcial');
    v_meses := greatest(1, v_meses);
  end if;

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
