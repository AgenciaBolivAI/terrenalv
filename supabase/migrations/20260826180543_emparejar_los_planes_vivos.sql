-- Los planes vivos que quedaron con cuotas desparejas —los cinco a los que la
-- última cuota les absorbió el ajuste de la seña— se emparejan: el capital
-- pendiente se reparte igual entre las cuotas que faltan, fechas y números
-- intactos. Un plan que ya estaba parejo no se toca.
do $$
declare
  r record;
  v_row record;
  v_base numeric(14,2);
  v_cuota numeric(12,2);
  v_ultima numeric(12,2);
  v_i int;
  v_cambiado boolean;
begin
  for r in
    select pl.id as plan_id,
           -- La base del reparto: el capital que falta MÁS lo ya pagado sobre
           -- cuotas parciales — porque el monto de una cuota parcial incluye
           -- lo que ya puso. Hoy no hay parciales; el día que haya, la cuenta
           -- ya está bien hecha.
           (select coalesce(sum((i.amount - i.interes)), 0)
              from public.installments i
             where i.plan_id = pl.id and i.status in ('pendiente','parcial')) as base,
           (select count(*) from public.installments i
             where i.plan_id = pl.id and i.status in ('pendiente','parcial')) as n
      from public.installment_plans pl
     where pl.status = 'activo' and coalesce(pl.monthly_interest_pct, 0) = 0
  loop
    continue when r.n = 0 or r.base <= 0;
    v_cuota  := round(r.base / r.n, 2);
    v_ultima := round(r.base - v_cuota * (r.n - 1), 2);
    if v_ultima <= 0 then
      raise exception 'EMPAREJADO_IMPOSIBLE: plan %, base %, n %', r.plan_id, r.base, r.n;
    end if;

    v_i := 0;
    v_cambiado := false;
    for v_row in
      select id, amount from public.installments
       where plan_id = r.plan_id and status in ('pendiente','parcial')
       order by due_date, number
    loop
      v_i := v_i + 1;
      if v_row.amount <> (case when v_i < r.n then v_cuota else v_ultima end) then
        update public.installments
           set amount = case when v_i < r.n then v_cuota else v_ultima end,
               updated_at = now()
         where id = v_row.id;
        v_cambiado := true;
      end if;
    end loop;

    if v_cambiado then
      update public.installment_plans
         set monthly_amount = v_cuota,
             months = r.n,
             note = coalesce(note || ' · ', '') || 'cuotas emparejadas',
             updated_at = now()
       where id = r.plan_id;
    end if;
  end loop;
end $$;

-- El guardián número 28: en un plan vivo sin interés, todas las cuotas
-- pendientes son iguales — la última puede variar solo por centavos. Corre
-- antes de cada despliegue y frena el build. Con interés no aplica: ahí la
-- igualdad la garantiza el sistema francés.
create or replace function public.verificar_integridad()
returns table(prueba text, ok boolean, detalle text)
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_d numeric; v_h numeric; v_n int; v_a numeric; v_pp numeric; v_proj uuid;
begin
  if auth.uid() is not null and not private.is_team() then
    raise exception 'FORBIDDEN';
  end if;

  select coalesce(sum(debe) - sum(haber), 0) into v_d from public.v_libro_diario where cuenta = '1131';
  select coalesce(sum(saldo), 0) into v_h from public.v_ventas;
  return query select 'cuenta_por_cobrar_es_la_de_pantalla'::text, (v_d = v_h),
    format('1131 %s / pantallas %s / diferencia %s', v_d, v_h, v_d - v_h);

  -- El cronograma de cada plan vivo cobra exactamente lo que se debe.
  select count(*) into v_n
    from public.installment_plans pl
    join public.v_ventas v on v.reservation_id = pl.reservation_id
   where pl.status = 'activo'
     and abs(coalesce((select sum(i.amount - i.interes)
                            - sum(greatest(0, i.amount_paid - i.interes))
                         from public.installments i
                        where i.plan_id = pl.id
                          and i.status in ('pendiente','parcial')), 0) - v.saldo) > 0.01;
  return query select 'el_plan_cobra_lo_que_se_debe'::text, (v_n = 0),
    format('%s plan(es) cuyo cronograma no cuadra con la deuda', v_n);

  -- Las cuotas vivas de un plan van numeradas de corrido, 1..n.
  select count(*) into v_n
    from (select i.plan_id
            from public.installments i
           where i.status <> 'anulada'
           group by i.plan_id
          having max(i.number) <> count(*) or min(i.number) <> 1) t;
  return query select 'cuotas_numeradas_de_corrido'::text, (v_n = 0),
    format('%s plan(es) con la numeración salteada', v_n);

  -- Las cuotas pendientes de un plan vivo sin interés son PAREJAS: todas
  -- iguales, y la última varía a lo sumo centavos de redondeo.
  select count(*) into v_n from (
    select i.plan_id
      from public.installments i
      join public.installment_plans pl on pl.id = i.plan_id
     where pl.status = 'activo'
       and coalesce(pl.monthly_interest_pct, 0) = 0
       and i.status in ('pendiente','parcial')
     group by i.plan_id
    having max(i.amount) - min(i.amount) > greatest(0.02, 0.01 * count(*))
  ) t;
  return query select 'cuotas_parejas'::text, (v_n = 0),
    format('%s plan(es) con cuotas desparejas', v_n);

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
$$;
