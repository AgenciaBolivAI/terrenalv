-- Al cobrar una cuota, el interés se cobra primero y el resto baja el
-- capital — como en cualquier crédito. Sin ese reparto, un comprador
-- terminaría de "pagar el lote" debiendo capital, y el interés se contaría
-- como precio del terreno en los libros.
create or replace function public.admin_register_cuota_payment(
  p_reservation_id uuid,
  p_amount numeric,
  p_paid_on date default null,
  p_provider public.payment_provider_kind default 'efectivo',
  p_reference text default null,
  p_note text default null,
  p_treasury_account_id uuid default null,
  p_currency char(3) default 'BOB',
  p_exchange_rate numeric default null,
  p_destino text default null,
  p_recalculo text default null
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
  v_mz_code text; v_lot_number text;
  v_cur char(3); v_rate numeric(10,4); v_pago_bob numeric(12,2);
  v_fecha timestamptz; v_saldo numeric(14,2);
  v_pay_id uuid; v_ref text;
  v_left numeric(12,2); v_take numeric(12,2);
  v_applied numeric(12,2) := 0; v_cuotas int := 0;
  v_interes_pago numeric(12,2) := 0; v_int_pend numeric(12,2); v_int_take numeric(12,2);
  v_row record; v_try int := 0;
  v_purpose text; v_destino text;
  v_principal numeric(12,2); v_nuevo numeric(12,2);
  v_tasa numeric; v_meses int; v_cuota numeric(12,2);
  v_interes numeric(12,2); v_capital numeric(12,2); v_pend numeric(12,2);
  v_i int; v_num int; v_next date; v_recalc jsonb := null;
begin
  v_actor := private.assert_accounting();

  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_destino is not null and p_destino not in ('cuota','capital') then
    raise exception 'INVALID_DESTINO';
  end if;
  if p_recalculo is not null and p_recalculo not in ('plazo','cuota') then
    raise exception 'INVALID_RECALCULO';
  end if;

  v_cur := upper(coalesce(nullif(btrim(coalesce(p_currency, '')), ''), 'BOB'));
  if v_cur not in ('BOB', 'USD') then raise exception 'INVALID_CURRENCY'; end if;

  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if v_res.status <> 'confirmada' then raise exception 'NO_ES_VENTA'; end if;

  select * into v_plan from public.installment_plans
   where reservation_id = p_reservation_id and status = 'activo';
  v_destino := case when not found then 'capital' else coalesce(p_destino, 'cuota') end;
  v_purpose := case when v_destino = 'cuota' then 'cuota' else 'abono' end;
  v_tasa := coalesce(v_plan.monthly_interest_pct, 0);

  if p_treasury_account_id is not null
     and not exists (select 1 from public.treasury_accounts
                      where id = p_treasury_account_id and is_active) then
    raise exception 'TREASURY_NOT_FOUND';
  end if;

  select * into v_project from public.projects where id = v_res.project_id;
  select m.code, l.number into v_mz_code, v_lot_number
    from public.lots l join public.manzanas m on m.id = l.manzana_id
   where l.id = v_res.lot_id;

  v_rate := coalesce(p_exchange_rate,
                     (private.get_setting(v_res.project_id, 'exchange_rate_bob_per_usd'))::numeric,
                     6.96);
  if v_cur = 'USD' and (v_rate < 1 or v_rate > 100) then
    raise exception 'INVALID_EXCHANGE_RATE';
  end if;
  v_pago_bob := case when v_cur = 'BOB' then p_amount else round(p_amount * v_rate, 2) end;

  -- El tope: capital que falta MÁS el interés todavía no cobrado del plan.
  -- Con interés, cobrar solo hasta el capital dejaría sin poder cobrar la
  -- última cuota completa.
  v_saldo := greatest(0, private.base_del_lote(p_reservation_id)
                        - private.capital_pagado(p_reservation_id));
  if v_destino = 'cuota' then
    select coalesce(sum(greatest(0, i.interes - least(i.amount_paid, i.interes))), 0)
      into v_int_pend from public.installments i
     where i.plan_id = v_plan.id and i.status in ('pendiente','parcial');
    v_saldo := v_saldo + v_int_pend;
  end if;
  if v_pago_bob > v_saldo + 0.01 then
    raise exception 'MONTO_EXCEDE_SALDO'
      using detail = format('máximo cobrable %s, cobro %s', v_saldo, v_pago_bob);
  end if;

  v_fecha := case when p_paid_on is null then now()
                  else (p_paid_on::text || ' 12:00:00')::timestamp at time zone 'America/La_Paz'
             end;

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
         v_pago_bob, v_rate, 'aprobado', v_actor, v_fecha, p_note, p_treasury_account_id)
      returning id into v_pay_id;
      exit;
    exception when unique_violation then
      if v_try >= 3 or nullif(btrim(coalesce(p_reference, '')), '') is not null then raise; end if;
    end;
  end loop;

  if v_destino = 'cuota' then
    v_left := v_pago_bob;
    for v_row in
      select id, amount, interes, amount_paid, amount - amount_paid as falta
        from public.installments
       where plan_id = v_plan.id and status in ('pendiente', 'parcial')
       order by number
       for update
    loop
      exit when v_left <= 0;
      v_take := least(v_left, v_row.falta);
      if v_take > 0 then
        -- Dentro de la cuota, primero el interés del mes.
        v_int_pend := greatest(0, v_row.interes - least(v_row.amount_paid, v_row.interes));
        v_int_take := least(v_take, v_int_pend);
        v_interes_pago := round(v_interes_pago + v_int_take, 2);

        insert into public.payment_allocations (payment_id, installment_id, amount)
        values (v_pay_id, v_row.id, v_take);
        v_left := round(v_left - v_take, 2);
        v_applied := round(v_applied + v_take, 2);
        v_cuotas := v_cuotas + 1;
      end if;
    end loop;

    update public.payments set interest_bob = v_interes_pago where id = v_pay_id;

    update public.installments i
       set paid_at = v_fecha, updated_at = now()
     where i.status = 'pagada' and coalesce(i.paid_at, now()) > v_fecha
       and exists (select 1 from public.payment_allocations pa
                    where pa.installment_id = i.id and pa.payment_id = v_pay_id);

  elsif v_plan.id is not null then
    -- ABONO A CAPITAL: baja el capital que falta y re-amortiza lo que queda.
    select coalesce(sum(
             (i.amount - i.interes) - greatest(0, i.amount_paid - i.interes)), 0)
      into v_principal
      from public.installments i
     where i.plan_id = v_plan.id and i.status in ('pendiente','parcial');
    v_nuevo := round(v_principal - v_pago_bob, 2);

    select count(*) into v_meses from public.installments
     where plan_id = v_plan.id and status in ('pendiente','parcial') and due_date >= current_date;
    select min(due_date) into v_next from public.installments
     where plan_id = v_plan.id and status in ('pendiente','parcial') and due_date >= current_date;
    v_next := coalesce(v_next, (current_date + interval '1 month')::date);

    update public.installments set status = 'anulada', updated_at = now()
     where plan_id = v_plan.id and status in ('pendiente','parcial');

    if v_nuevo <= 0.01 then
      update public.installment_plans
         set status = 'completado',
             base_amount = greatest(0, base_amount - v_pago_bob),
             financed_amount = greatest(0, base_amount - v_pago_bob - down_payment),
             note = coalesce(note || ' · ', '') || 'cancelado por abono a capital',
             updated_at = now()
       where id = v_plan.id;
      v_recalc := jsonb_build_object('modo','cancelado','meses',0,'cuota',0,'saldo_plan',0);
    else
      if coalesce(p_recalculo, 'plazo') = 'plazo' then
        v_cuota := v_plan.monthly_amount;
        if v_tasa > 0 then
          -- Con interés no alcanza con dividir: la cuota tiene que superar el
          -- interés del mes o la deuda no bajaría nunca.
          if v_cuota <= round(v_nuevo * v_tasa / 100, 2) then
            raise exception 'CUOTA_NO_CUBRE_INTERES'
              using detail = format('la cuota %s no cubre el interés mensual de %s',
                                    v_cuota, round(v_nuevo * v_tasa / 100, 2));
          end if;
          v_meses := greatest(1, ceil(
            ln(v_cuota / (v_cuota - v_nuevo * v_tasa / 100)) / ln(1 + v_tasa / 100))::int);
        else
          v_meses := greatest(1, ceil(v_nuevo / v_cuota)::int);
        end if;
      else
        v_meses := greatest(1, v_meses);
        v_cuota := case when v_tasa > 0
                        then round(v_nuevo * (v_tasa/100) / (1 - power(1 + v_tasa/100, -v_meses)), 2)
                        else ceil(v_nuevo / v_meses * 100) / 100 end;
      end if;

      select coalesce(max(number), 0) into v_num from public.installments where plan_id = v_plan.id;
      v_pend := v_nuevo;
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
          (v_plan.id, v_res.project_id, v_num,
           (v_next + (v_i - 1) * interval '1 month')::date,
           round(v_capital + v_interes, 2), v_interes, v_plan.currency);
      end loop;

      update public.installment_plans
         set months = v_meses, monthly_amount = v_cuota,
             base_amount = greatest(0, base_amount - v_pago_bob),
             financed_amount = greatest(0, base_amount - v_pago_bob - down_payment),
             first_due_date = v_next,
             note = coalesce(note || ' · ', '') || 'abono a capital', updated_at = now()
       where id = v_plan.id;
      v_recalc := jsonb_build_object('modo', coalesce(p_recalculo, 'plazo'),
                                     'meses', v_meses, 'cuota', v_cuota,
                                     'saldo_plan', v_nuevo);
    end if;
    v_applied := 0; v_left := 0;
  end if;

  perform private.audit('team', v_actor, null,
    case when v_destino = 'cuota' then 'cuota.registered' else 'abono.registered' end,
    v_res.project_id, 'reservation', v_res.id,
    null, jsonb_build_object('payment_id', v_pay_id, 'monto', p_amount, 'moneda', v_cur,
                             'monto_bob', v_pago_bob, 'interes', v_interes_pago,
                             'capital', v_pago_bob - v_interes_pago,
                             'tipo', v_purpose, 'destino', v_destino,
                             'forma', p_provider, 'recalculo', v_recalc,
                             'aplicado', v_applied, 'sobrante', v_left, 'cuotas', v_cuotas));

  return jsonb_build_object(
    'payment_id', v_pay_id, 'reference_code', v_ref, 'tipo', v_purpose,
    'destino', v_destino, 'moneda', v_cur, 'cambio', v_rate, 'monto_bob', v_pago_bob,
    'interes', v_interes_pago, 'capital', v_pago_bob - v_interes_pago,
    'aplicado', v_applied, 'sobrante', coalesce(v_left, 0), 'cuotas_afectadas', v_cuotas,
    'plan_recalculado', v_recalc);
end;
$fn$;

revoke execute on function public.admin_register_cuota_payment(
  uuid, numeric, date, public.payment_provider_kind, text, text, uuid, char, numeric, text, text)
  from public, anon;
grant execute on function public.admin_register_cuota_payment(
  uuid, numeric, date, public.payment_provider_kind, text, text, uuid, char, numeric, text, text)
  to authenticated, service_role;

-- ---- La suite vigila el reparto: el interés nunca puede pasar del pago, y
--      un pago sin plan no puede traer interés de la nada.
create or replace function public.verificar_integridad()
returns table (prueba text, ok boolean, detalle text)
language plpgsql stable security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare v_d numeric; v_h numeric; v_n int; v_a numeric; v_pp numeric; v_proj uuid;
begin
  if auth.uid() is not null and not private.is_team() then
    raise exception 'FORBIDDEN';
  end if;

  select coalesce(sum(debe) - sum(haber), 0) into v_d from public.v_libro_diario where cuenta = '1131';
  select coalesce(sum(saldo), 0) into v_h from public.v_ventas;
  return query select 'cuenta_por_cobrar_es_la_de_pantalla'::text, (v_d = v_h),
    format('1131 %s / pantallas %s / diferencia %s', v_d, v_h, v_d - v_h);

  select count(*) into v_n from public.payments
   where coalesce(interest_bob, 0) > amount_bob + 0.01;
  return query select 'interes_nunca_supera_el_pago'::text, (v_n = 0),
    format('%s pago(s) con interés mayor al monto', v_n);

  select count(*) into v_n from public.payments p
   where coalesce(p.interest_bob, 0) > 0 and p.purpose <> 'cuota';
  return query select 'solo_las_cuotas_llevan_interes'::text, (v_n = 0),
    format('%s pago(s) con interés fuera de una cuota', v_n);

  select count(*) into v_n from public.installments where interes > amount + 0.01;
  return query select 'interes_de_cuota_coherente'::text, (v_n = 0),
    format('%s cuota(s) donde el interés supera la cuota', v_n);

  select count(*) into v_n from public.payments
   where status = 'aprobado' and verified_at is null;
  return query select 'todo_aprobado_tiene_fecha'::text, (v_n = 0),
    format('%s pago(s) aprobado(s) sin fecha de verificación', v_n);

  select count(*) into v_n from public.installments i
    join public.installment_plans pl on pl.id = i.plan_id
   where pl.status <> 'activo' and i.status in ('pendiente','parcial');
  return query select 'planes_muertos_sin_cuotas_vivas'::text, (v_n = 0),
    format('%s cuota(s) viva(s) en planes cancelados o completados', v_n);

  select count(*) into v_n from public.market_listings ml
    join public.reservations r on r.id = ml.reservation_id
   where ml.status in ('activa','pausada') and r.status <> 'confirmada';
  return query select 'avisos_vivos_solo_sobre_ventas_vivas'::text, (v_n = 0),
    format('%s aviso(s) del mercado sobre reservas que ya no son ventas', v_n);

  select count(*) into v_n from public.financing_tiers a
    join public.financing_tiers b on b.id <> a.id
                                 and b.project_id is not distinct from a.project_id
                                 and a.price_from <= coalesce(b.price_to, 999999999)
                                 and coalesce(a.price_to, 999999999) >= b.price_from
   where a.is_active and b.is_active;
  return query select 'clasificaciones_de_precio_sin_solape'::text, (v_n = 0),
    format('%s clasificación(es) con rangos que se pisan', v_n);

  select coalesce(sum(debe),0), coalesce(sum(haber),0) into v_d, v_h from public.v_libro_diario;
  return query select 'diario_cuadra'::text, (v_d = v_h),
    format('debe %s / haber %s / diferencia %s', v_d, v_h, v_d - v_h);

  select count(*) into v_n from (
    select project_id from public.v_libro_diario group by project_id having sum(debe) <> sum(haber)) t;
  return query select 'diario_cuadra_por_urbanizacion'::text, (v_n = 0),
    format('%s urbanización(es) descuadrada(s)', v_n);

  select coalesce(sum(case when seccion = 'Activo' then monto else 0 end), 0),
         coalesce(sum(case when seccion in ('Pasivo','Patrimonio') then monto else 0 end), 0)
    into v_a, v_pp from public.rep_balance_general(null, null);
  return query select 'balance_consolidado_cuadra'::text, (round(v_a,2) = round(v_pp,2)),
    format('activo %s / pasivo+patrimonio %s', round(v_a,2), round(v_pp,2));

  v_n := 0;
  for v_proj in select p.id from public.projects p where p.status <> 'archivado'
  loop
    select coalesce(sum(case when seccion = 'Activo' then monto else 0 end), 0)
         - coalesce(sum(case when seccion in ('Pasivo','Patrimonio') then monto else 0 end), 0)
      into v_d from public.rep_balance_general(v_proj, null);
    if round(v_d, 2) <> 0 then v_n := v_n + 1; end if;
  end loop;
  return query select 'balance_por_urbanizacion_cuadra'::text, (v_n = 0),
    format('%s urbanización(es) con balance descuadrado', v_n);

  select coalesce(sum(monto),0) into v_d
    from public.rep_estado_resultados(null, null, null) where seccion = 'Gastos';
  select coalesce(sum(t.g),0) into v_h from (
    select (select coalesce(sum(monto),0) from public.rep_estado_resultados(p.id, null, null)
             where seccion = 'Gastos') as g
      from public.projects p where p.status <> 'archivado') t;
  return query select 'consolidado_es_la_suma_de_partes'::text, (round(v_d,2) = round(v_h,2)),
    format('consolidado %s / suma %s', round(v_d,2), round(v_h,2));

  select count(*) into v_n from public.v_tesoreria_saldos
   where round(saldo, 2) <> round(opening_balance + entradas - salidas, 2);
  return query select 'saldos_de_tesoreria_coherentes'::text, (v_n = 0),
    format('%s cuenta(s) donde saldo <> inicial + entradas - salidas', v_n);

  select count(*) into v_n from public.treasury_accounts t
   where not exists (select 1 from public.chart_of_accounts c where c.code = t.account_code);
  return query select 'cada_cuenta_tiene_su_cuenta_contable'::text, (v_n = 0),
    format('%s cuenta(s) de tesorería sin cuenta en el plan', v_n);

  select count(*) into v_n from public.projects p
   where p.status <> 'archivado'
     and not exists (select 1 from public.v_an_por_proyecto v where v.project_id = p.id);
  return query select 'todas_las_urbanizaciones_en_analitica'::text, (v_n = 0),
    format('%s urbanización(es) que no aparecen en el tablero', v_n);

  select count(*) into v_n from public.projects where currency <> 'BOB';
  return query select 'solo_bolivianos'::text, (v_n = 0),
    format('%s urbanización(es) en otra moneda', v_n);

  select count(*) into v_n from (values
      ('v_an_colocacion','valor_colocado_bob'), ('v_an_aging','monto_bob'),
      ('v_an_proyeccion','por_cobrar_bob'), ('v_an_equipo','monto_vendido_bob')) as req(t, c)
   where not exists (select 1 from information_schema.columns i
                      where i.table_schema='public' and i.table_name=req.t and i.column_name=req.c);
  return query select 'analitica_tiene_columnas_en_bolivianos'::text, (v_n = 0),
    format('%s columna(s) normalizada(s) faltante(s)', v_n);

  select count(*) into v_n from public.lots l
   where l.deleted_at is null
     and not exists (select 1 from public.projects p where p.id = l.project_id);
  return query select 'sin_lotes_huerfanos'::text, (v_n = 0), format('%s lote(s) sin urbanización', v_n);

  select count(*) into v_n from public.reservations r
   where r.status in ('pendiente_pago','en_verificacion','confirmada')
     and not exists (select 1 from public.lots l where l.id = r.lot_id and l.deleted_at is null);
  return query select 'reservas_vivas_apuntan_a_un_lote'::text, (v_n = 0),
    format('%s reserva(s) viva(s) sin lote', v_n);

  select count(*) into v_n from public.lots l
   where l.deleted_at is null and l.status in ('reservado','vendido')
     and (l.active_reservation_id is null
          or not exists (select 1 from public.reservations r
                          where r.id = l.active_reservation_id
                            and r.status in ('pendiente_pago','en_verificacion','confirmada')));
  return query select 'lotes_ocupados_tienen_reserva_viva'::text, (v_n = 0),
    format('%s lote(s) bloqueado(s) sin reserva que lo justifique', v_n);

  select count(*) into v_n from public.reservations
   where status = 'en_verificacion' and (hold_expires_at is not null or retry_expires_at is not null);
  return query select 'comprobante_subido_pausa_el_reloj'::text, (v_n = 0),
    format('%s reserva(s) en verificación con vencimiento activo', v_n);

  select count(*) into v_n from public.payments p
   where p.status = 'aprobado' and p.verified_at is not null
     and not exists (select 1 from public.v_libro_diario d where d.origen_id = p.id);
  return query select 'todo_pago_aprobado_esta_en_el_libro'::text, (v_n = 0),
    format('%s pago(s) aprobado(s) fuera del libro', v_n);

  select count(*) into v_n from public.reservations nueva
   where nueva.client_meta ? 'traspaso' and nueva.status = 'confirmada'
     and not exists (
       select 1 from public.reservations vieja
        where vieja.id = (nueva.client_meta->'traspaso'->>'de_reservation')::uuid
          and vieja.status = 'cancelada'
          and (vieja.client_meta->'traspasada_a'->>'reservation')::uuid = nueva.id
          and vieja.lot_id = nueva.lot_id);
  return query select 'traspasos_bien_enlazados'::text, (v_n = 0),
    format('%s traspaso(s) con la cadena rota', v_n);

  select count(*) into v_n from public.reservations nueva
   where nueva.client_meta ? 'traspaso' and nueva.status = 'confirmada'
     and not exists (select 1 from public.lots l
                      where l.id = nueva.lot_id and l.active_reservation_id = nueva.id);
  return query select 'lote_sigue_al_traspaso'::text, (v_n = 0),
    format('%s traspaso(s) cuyo lote no apunta al comprador nuevo', v_n);

  select (select count(*) from public.market_listings ml
           where (ml.fee_payment_id is not null and not exists (
                    select 1 from public.payments p
                     where p.id = ml.fee_payment_id and p.purpose = 'comision'
                       and p.status = 'aprobado' and p.amount_bob = ml.fee_bob))
              or (ml.fee_bob is not null and ml.sale_price_bob is not null
                  and ml.fee_bob <> round(ml.sale_price_bob * ml.fee_pct / 100.0, 2)))
       + (select count(*) from public.payments p
           where p.purpose = 'comision'
             and not exists (select 1 from public.market_listings ml where ml.fee_payment_id = p.id))
    into v_n;
  return query select 'comisiones_del_mercado_consistentes'::text, (v_n = 0),
    format('%s comisión(es) inconsistente(s)', v_n);
end;
$fn$;

revoke execute on function public.verificar_integridad() from public, anon;
grant execute on function public.verificar_integridad() to authenticated, service_role;
