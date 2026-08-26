-- El cronograma cobraba Bs 1.000 de más.
--
-- Cinco planes se crearon ANTES de que la seña se aplicara al precio, y sus
-- cuotas quedaron armadas sobre precio − inicial, sin restar la seña. El
-- comprador de LPV-DEMO2 debe Bs 40.250 y su cronograma sumaba Bs 41.250.
-- Nada lo detectaba: verificar_integridad() cuadra el libro contra las
-- pantallas, pero nunca cuadraba el cronograma contra la deuda.
--
-- Tres cosas, en orden:
--   1. La causa: reprogramar un plan confiaba en las cuotas del propio plan.
--      Ahora se ancla a la deuda real (precio − capital pagado), así que
--      cualquier plan torcido se endereza solo al tocarlo.
--   2. Los datos: la última cuota pendiente absorbe el ajuste — es la
--      práctica de siempre, la cuota de ajuste va al final.
--   3. El guardián: un chequeo nuevo en verificar_integridad(), que corre
--      antes de CADA despliegue (predeploy lo consulta y frena el build).
--      Un cronograma que no cuadre con la deuda nunca más pasa callado.

-- ---------- 1. la causa ----------------------------------------------------
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
  -- deuda reportada) menos capital pagado, seña incluida. El cronograma es un
  -- plan de cobro; la deuda es la verdad. Si alguna vez se separaron, acá se
  -- vuelven a juntar.
  v_pendiente := greatest(0, private.base_del_lote(p_plan_id_reserva(p_plan_id))
                           - private.capital_pagado(p_plan_id_reserva(p_plan_id)));

  if v_pendiente <= 0.01 then
    raise exception 'NADA_QUE_REPROGRAMAR'
      using detail = 'Este plan ya no tiene capital pendiente.';
  end if;

  if p_meses is not null then
    if p_meses < 1 or p_meses > 480 then raise exception 'INVALID_MONTHS'; end if;
    v_meses := p_meses;
    v_cuota := case when v_tasa > 0
                    then round(v_pendiente * (v_tasa/100) / (1 - power(1 + v_tasa/100, -v_meses)), 2)
                    else ceil(v_pendiente / v_meses * 100) / 100 end;
    if p_cuota is not null then
      v_cuota := round(p_cuota, 2);
      if v_cuota <= 0 then raise exception 'INVALID_MONTHLY'; end if;
      if v_tasa > 0 and v_cuota <= round(v_pendiente * v_tasa / 100, 2) then
        raise exception 'CUOTA_NO_CUBRE_INTERES'
          using detail = format('con %s de saldo, el interés del mes es %s',
                                v_pendiente, round(v_pendiente * v_tasa / 100, 2));
      end if;
      v_meses := case when v_tasa > 0
                      then greatest(1, ceil(ln(v_cuota / (v_cuota - v_pendiente * v_tasa / 100))
                                            / ln(1 + v_tasa / 100))::int)
                      else greatest(1, ceil(v_pendiente / v_cuota)::int) end;
    end if;
  elsif p_cuota is not null then
    v_cuota := round(p_cuota, 2);
    if v_cuota <= 0 then raise exception 'INVALID_MONTHLY'; end if;
    if v_tasa > 0 and v_cuota <= round(v_pendiente * v_tasa / 100, 2) then
      raise exception 'CUOTA_NO_CUBRE_INTERES'
        using detail = format('con %s de saldo, el interés del mes es %s',
                              v_pendiente, round(v_pendiente * v_tasa / 100, 2));
    end if;
    v_meses := case when v_tasa > 0
                    then greatest(1, ceil(ln(v_cuota / (v_cuota - v_pendiente * v_tasa / 100))
                                          / ln(1 + v_tasa / 100))::int)
                    else greatest(1, ceil(v_pendiente / v_cuota)::int) end;
  else
    select count(*) into v_meses from public.installments
     where plan_id = p_plan_id and status in ('pendiente','parcial');
    v_meses := greatest(1, v_meses);
    v_cuota := case when v_tasa > 0
                    then round(v_pendiente * (v_tasa/100) / (1 - power(1 + v_tasa/100, -v_meses)), 2)
                    else ceil(v_pendiente / v_meses * 100) / 100 end;
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
