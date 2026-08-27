-- Los pagos migrados del sistema viejo no tienen asignaciones: sus cuotas se
-- marcaron pagadas a mano en la migración. Al anular uno de esos, el trigger
-- no tiene nada que borrar y el cronograma quedaba diciendo «pagada» sobre una
-- deuda que volvió a crecer — lo cazó el guardián el_plan_cobra_lo_que_se_debe.
--
-- La cura: si la anulación no borró ninguna asignación y la venta tiene plan,
-- se desanda el cronograma desde la última cuota pagada hacia atrás hasta
-- devolver el capital del pago anulado. Y un plan que estaba completado
-- vuelve a estar activo, porque otra vez se le debe.
--
-- De paso: en modo «error de registro» el retenido informado es 0 — no se
-- retuvo nada, porque la plata nunca entró.

create or replace function public.admin_anular_pago(
  p_payment_id uuid,
  p_nota text,
  p_modo text default 'error',
  p_monto_devuelto numeric default null,
  p_treasury_devolucion uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_actor uuid;
  v_pay public.payments%rowtype;
  v_monto numeric(12,2);
  v_devuelto numeric(12,2);
  v_cta_original text;
  v_cta_devolucion text;
  v_lines jsonb := '[]'::jsonb;
  v_res jsonb;
  v_comprobante text := null;
  v_allocs int;
  v_plan uuid;
  v_falta numeric(12,2);
  v_cuota record;
begin
  v_actor := private.assert_accounting();
  if btrim(coalesce(p_nota, '')) = '' then raise exception 'NOTE_REQUIRED'; end if;
  if p_modo not in ('error', 'devolucion') then raise exception 'MODO_INVALIDO'; end if;

  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then raise exception 'PAGO_NO_ENCONTRADO'; end if;
  if v_pay.status <> 'aprobado' then
    raise exception 'PAGO_NO_APROBADO'
      using detail = 'Solo se anula un pago aprobado: los demás nunca sumaron.';
  end if;

  perform private.assert_periodo_abierto(v_pay.project_id,
    (v_pay.verified_at at time zone 'America/La_Paz')::date);

  v_monto := v_pay.amount_bob;
  v_devuelto := case when p_modo = 'error' then 0
                     else round(coalesce(p_monto_devuelto, v_monto), 2) end;
  if v_devuelto < 0 or v_devuelto > v_monto then
    raise exception 'DEVOLUCION_INVALIDA'
      using detail = format('Lo devuelto va de 0 a %s, que fue lo que pagó.', v_monto);
  end if;

  -- 1) El pago deja de contar: el libro pierde sus dos patas a la vez, la
  --    deuda vuelve y las pantallas cuadran solas.
  update public.payments
     set status = 'cancelado',
         rejection_note = btrim(p_nota)
           || case when p_modo = 'devolucion'
                   then format(' · anulado con devolución de Bs %s', v_devuelto)
                   else ' · anulado por error de registro' end,
         updated_at = now()
   where id = p_payment_id;

  -- 2) Las cuotas que este pago marcaba se desmarcan: el trigger de
  --    asignaciones recalcula al borrar.
  delete from public.payment_allocations where payment_id = p_payment_id;
  get diagnostics v_allocs = row_count;

  -- 2b) Pago migrado, sin asignaciones: desandar el cronograma a mano, de la
  --     última cuota pagada hacia atrás, hasta devolver el capital anulado.
  if v_allocs = 0 then
    select ip.id into v_plan from public.installment_plans ip
     where ip.reservation_id = v_pay.reservation_id
       and ip.status in ('activo', 'completado')
     order by ip.created_at desc limit 1;
    if v_plan is not null then
      v_falta := round(v_monto - coalesce(v_pay.interest_bob, 0), 2);
      for v_cuota in
        select i.id, i.amount_paid,
               greatest(0, i.amount_paid - coalesce(i.interes, 0)) as capital
          from public.installments i
         where i.plan_id = v_plan and i.status in ('pagada', 'parcial')
           and i.amount_paid > 0
         order by i.number desc
      loop
        exit when v_falta <= 0.005;
        if v_cuota.capital <= v_falta + 0.005 then
          update public.installments
             set amount_paid = 0, status = 'pendiente', paid_at = null, updated_at = now()
           where id = v_cuota.id;
          v_falta := round(v_falta - v_cuota.capital, 2);
        else
          update public.installments
             set amount_paid = round(v_cuota.amount_paid - v_falta, 2),
                 status = 'parcial', paid_at = null, updated_at = now()
           where id = v_cuota.id;
          v_falta := 0;
        end if;
      end loop;
      -- Otra vez se le debe: el plan completado vuelve a la vida.
      update public.installment_plans set status = 'activo', updated_at = now()
       where id = v_plan and status = 'completado';
    end if;
  end if;

  -- 3) Si la plata entró de verdad, el asiento de la anulación.
  if p_modo = 'devolucion' then
    select coalesce(t.account_code, '1111') into v_cta_original
      from (select 1) _
      left join public.treasury_accounts t on t.id = v_pay.treasury_account_id;
    select coalesce(t.account_code, v_cta_original) into v_cta_devolucion
      from (select 1) _
      left join public.treasury_accounts t on t.id = p_treasury_devolucion;

    if not (v_devuelto = v_monto and v_cta_devolucion = v_cta_original) then
      v_lines := jsonb_build_array(
        jsonb_build_object('account_code', v_cta_original, 'debe', v_monto, 'haber', 0,
                           'glosa', 'lo recibido por el pago anulado'));
      if v_devuelto > 0 then
        v_lines := v_lines || jsonb_build_object(
          'account_code', v_cta_devolucion, 'debe', 0, 'haber', v_devuelto,
          'glosa', 'devuelto al comprador');
      end if;
      if v_monto - v_devuelto > 0 then
        v_lines := v_lines || jsonb_build_object(
          'account_code', '4911', 'debe', 0, 'haber', round(v_monto - v_devuelto, 2),
          'glosa', 'no devuelto — queda como ingreso');
      end if;

      v_res := public.admin_save_voucher(
        v_pay.project_id,
        current_date,
        'ajuste'::voucher_kind,
        format('Anulación del pago %s — %s', v_pay.reference_code, btrim(p_nota)),
        v_lines, null, true);
      v_comprobante := v_res->>'number';
    end if;
  end if;

  perform private.audit('team', v_actor, null, 'pago.anulado', v_pay.project_id,
    'payment', p_payment_id,
    jsonb_build_object('monto', v_monto, 'referencia', v_pay.reference_code),
    jsonb_build_object('modo', p_modo, 'devuelto', v_devuelto,
                       'comprobante', v_comprobante, 'nota', btrim(p_nota)));

  return jsonb_build_object('ok', true, 'monto', v_monto, 'devuelto', v_devuelto,
    'retenido', case when p_modo = 'devolucion' then round(v_monto - v_devuelto, 2) else 0 end,
    'comprobante', v_comprobante);
end;
$$;
