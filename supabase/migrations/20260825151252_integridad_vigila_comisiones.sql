-- La suite de integridad vigila también las comisiones del mercado: cada aviso
-- cerrado con comisión apunta a un pago aprobado por el monto exacto, el monto
-- es el porcentaje pactado del precio, y no existen comisiones huérfanas.
create or replace function public.verificar_integridad()
returns table (prueba text, ok boolean, detalle text)
language plpgsql
stable
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_d numeric; v_h numeric; v_n int; v_a numeric; v_pp numeric; v_proj uuid;
begin
  select coalesce(sum(debe),0), coalesce(sum(haber),0) into v_d, v_h
    from public.v_libro_diario;
  return query select 'diario_cuadra'::text, (v_d = v_h),
    format('debe %s / haber %s / diferencia %s', v_d, v_h, v_d - v_h);

  select count(*) into v_n from (
    select project_id from public.v_libro_diario
     group by project_id having sum(debe) <> sum(haber)) t;
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
      ('v_an_colocacion','valor_colocado_bob'),
      ('v_an_aging','monto_bob'),
      ('v_an_proyeccion','por_cobrar_bob'),
      ('v_an_equipo','monto_vendido_bob')) as req(t, c)
   where not exists (
     select 1 from information_schema.columns i
      where i.table_schema='public' and i.table_name=req.t and i.column_name=req.c);
  return query select 'analitica_tiene_columnas_en_bolivianos'::text, (v_n = 0),
    format('%s columna(s) normalizada(s) faltante(s)', v_n);

  select count(*) into v_n from public.lots l
   where l.deleted_at is null
     and not exists (select 1 from public.projects p where p.id = l.project_id);
  return query select 'sin_lotes_huerfanos'::text, (v_n = 0),
    format('%s lote(s) sin urbanización', v_n);

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
   where status = 'en_verificacion'
     and (hold_expires_at is not null or retry_expires_at is not null);
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

  -- Comisiones del mercado: el aviso cerrado con comisión apunta a un pago
  -- aprobado por el monto exacto, el monto es el % pactado del precio, y toda
  -- comisión cobrada pertenece a un aviso.
  select (select count(*) from public.market_listings ml
           where (ml.fee_payment_id is not null and not exists (
                    select 1 from public.payments p
                     where p.id = ml.fee_payment_id and p.purpose = 'comision'
                       and p.status = 'aprobado' and p.amount_bob = ml.fee_bob))
              or (ml.fee_bob is not null and ml.sale_price_bob is not null
                  and ml.fee_bob <> round(ml.sale_price_bob * ml.fee_pct / 100.0, 2)))
       + (select count(*) from public.payments p
           where p.purpose = 'comision'
             and not exists (select 1 from public.market_listings ml
                              where ml.fee_payment_id = p.id))
    into v_n;
  return query select 'comisiones_del_mercado_consistentes'::text, (v_n = 0),
    format('%s comisión(es) inconsistente(s)', v_n);
end;
$fn$;

revoke execute on function public.verificar_integridad() from public, anon;
grant execute on function public.verificar_integridad() to authenticated, service_role;
