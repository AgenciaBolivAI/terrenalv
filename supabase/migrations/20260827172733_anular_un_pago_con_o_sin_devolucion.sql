-- ANULAR UN PAGO SUELTO — no toda la venta: una cuota cobrada de más, un
-- cobro duplicado, un pago que se registró mal.
--
-- Dos maneras, porque son dos cosas distintas:
--
--   · ERROR DE REGISTRO: la plata nunca entró de verdad (se cargó dos veces,
--     se eligió mal la venta). El pago se cancela y desaparece del libro:
--     la deuda vuelve sola, las cuotas se desmarcan solas (el trigger de
--     asignaciones recalcula), y no hay más asiento que hacer.
--
--   · ANULACIÓN CON DEVOLUCIÓN: la plata SÍ entró, y se devuelve todo, parte
--     o nada (monto editable). La contabilidad honesta: la caja original SÍ
--     recibió; lo devuelto sale de la caja que se elija; lo NO devuelto es
--     ingreso (4911 Ingresos por Anulaciones). El asiento se emite solo.
--
-- El pago anulado no se borra: queda 'cancelado' con su nota — es la
-- explicación cuando el comprador diga que ya pagó.

insert into public.chart_of_accounts (code, name, kind, sort_order, is_active, is_system)
values ('4911', 'Ingresos por Anulaciones y Penalidades', 'ingreso', 491, true, false)
on conflict (code) do nothing;

create or replace function public.admin_anular_pago(
  p_payment_id uuid,
  p_nota text,
  p_modo text default 'error',                -- 'error' | 'devolucion'
  p_monto_devuelto numeric default null,      -- editable; null = todo
  p_treasury_devolucion uuid default null)    -- de qué caja sale lo devuelto
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

  -- Un pago de una gestión cerrada no se anula: cambiaría estados firmados.
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
  --    asignaciones recalcula amount_paid y estado al borrar.
  delete from public.payment_allocations where payment_id = p_payment_id;

  -- 3) Si la plata entró de verdad, el asiento de la anulación:
  --    Dr caja original (recibió y retuvo) / Cr caja de devolución (lo que
  --    salió) / Cr 4911 (lo que quedó en casa).
  if p_modo = 'devolucion' then
    select coalesce(t.account_code, '1111') into v_cta_original
      from (select 1) _
      left join public.treasury_accounts t on t.id = v_pay.treasury_account_id;
    select coalesce(t.account_code, v_cta_original) into v_cta_devolucion
      from (select 1) _
      left join public.treasury_accounts t on t.id = p_treasury_devolucion;

    -- Si todo vuelve por la misma caja, las patas se cancelan: sin asiento.
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
                            'retenido', round(v_monto - v_devuelto, 2),
                            'comprobante', v_comprobante);
end;
$$;

grant execute on function public.admin_anular_pago(uuid, text, text, numeric, uuid) to authenticated;
revoke execute on function public.admin_anular_pago(uuid, text, text, numeric, uuid) from anon;
