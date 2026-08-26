-- El plan se edita entero: interés, plazo, cuota, inicial y desde cuándo.
--
-- Hasta ahora, para cambiar el interés de un plan ya firmado había que
-- cancelarlo y armar otro — perdiendo el rastro de lo que ya se había pagado.
-- Un plan es un acuerdo entre dos personas y los acuerdos se renegocian: el
-- comprador pide más plazo, la empresa le baja el interés, se pacta otra
-- cuota. Eso tiene que poder registrarse tal como pasó.
--
-- Lo que NO se toca nunca: las cuotas ya pagadas. Reescribirlas sería cambiar
-- la historia de la plata que entró.
create or replace function public.admin_editar_plan(
  p_plan_id uuid,
  p_interes_mensual numeric default null,
  p_meses int default null,
  p_cuota numeric default null,
  p_primera_fecha date default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid;
  v_plan public.installment_plans%rowtype;
  v_antes jsonb;
  v_pendiente numeric(14,2);   -- capital que falta, sin intereses
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

  -- El capital que todavía falta: lo pendiente de las cuotas vivas, sin su
  -- interés. Es sobre ESO que se rearma — no sobre el precio, que ya se
  -- pagó en parte.
  select coalesce(sum((i.amount - i.interes) - greatest(0, i.amount_paid - i.interes)), 0)
    into v_pendiente
    from public.installments i
   where i.plan_id = p_plan_id and i.status in ('pendiente','parcial');

  if v_pendiente <= 0.01 then
    raise exception 'NADA_QUE_REPROGRAMAR'
      using detail = 'Este plan ya no tiene capital pendiente.';
  end if;

  -- Plazo y cuota: se puede fijar uno y que el otro salga solo.
  if p_meses is not null then
    if p_meses < 1 or p_meses > 480 then raise exception 'INVALID_MONTHS'; end if;
    v_meses := p_meses;
    v_cuota := case when v_tasa > 0
                    then round(v_pendiente * (v_tasa/100) / (1 - power(1 + v_tasa/100, -v_meses)), 2)
                    else ceil(v_pendiente / v_meses * 100) / 100 end;
    -- Si además indicaron cuota, manda la cuota y el plazo se recalcula.
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
    -- Solo cambió el interés (o la fecha): se conserva la cantidad de cuotas
    -- que faltaban y se recalcula lo que hay que pagar por mes.
    select count(*) into v_meses from public.installments
     where plan_id = p_plan_id and status in ('pendiente','parcial');
    v_meses := greatest(1, v_meses);
    v_cuota := case when v_tasa > 0
                    then round(v_pendiente * (v_tasa/100) / (1 - power(1 + v_tasa/100, -v_meses)), 2)
                    else ceil(v_pendiente / v_meses * 100) / 100 end;
  end if;

  -- Desde cuándo corre lo que queda.
  if p_primera_fecha is not null then
    v_next := p_primera_fecha;
  else
    select min(due_date) into v_next from public.installments
     where plan_id = p_plan_id and status in ('pendiente','parcial');
    v_next := coalesce(v_next, (current_date + interval '1 month')::date);
  end if;

  -- Fuera el cronograma viejo pendiente; las pagadas quedan intactas.
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
$fn$;

revoke execute on function public.admin_editar_plan(uuid, numeric, int, numeric, date, text)
  from public, anon;
grant execute on function public.admin_editar_plan(uuid, numeric, int, numeric, date, text)
  to authenticated, service_role;
