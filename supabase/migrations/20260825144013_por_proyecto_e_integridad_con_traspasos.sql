-- El tablero por urbanización cuenta ventas VIVAS y expone los traspasos, y la
-- suite de integridad vigila que cada traspaso quede bien enlazado.
create or replace view public.v_an_por_proyecto
with (security_invoker = true) as
select p.id as project_id,
       p.name, p.slug, p.status, p.currency,
       coalesce(lo.lotes, 0)        as lotes,
       coalesce(lo.disponibles, 0)  as disponibles,
       coalesce(lo.vendidos, 0)     as vendidos,
       coalesce(lo.reservados, 0)   as reservados,
       coalesce(lo.sin_precio, 0)   as sin_precio,
       case when coalesce(lo.lotes, 0) > 0
            then round(((coalesce(lo.vendidos, 0) + coalesce(lo.reservados, 0))::numeric
                        / lo.lotes) * 100, 1)
            else 0 end as pct_colocado,
       coalesce(ve.valor_colocado_bob, 0) as valor_colocado_bob,
       coalesce(ve.ventas, 0)             as ventas,
       ve.ultima_venta,
       coalesce(cc.por_cobrar_bob, 0) as por_cobrar_bob,
       coalesce(cc.vencido_bob, 0)    as vencido_bob,
       coalesce(cc.planes_activos, 0) as planes_activos,
       coalesce(fi.ingresos_bob, 0)  as ingresos_bob,
       coalesce(fi.egresos_bob, 0)   as egresos_bob,
       coalesce(fi.ingresos_bob, 0) - coalesce(fi.egresos_bob, 0) as resultado_bob,
       coalesce(tr.traspasos, 0) as traspasos
  from public.projects p
  left join lateral (
    select count(*) as lotes,
           count(*) filter (where l.status = 'disponible') as disponibles,
           count(*) filter (where l.status = 'vendido')    as vendidos,
           count(*) filter (where l.status = 'reservado')  as reservados,
           count(*) filter (where public.lot_price(l.id) is null) as sin_precio
      from public.lots l
     where l.project_id = p.id and l.deleted_at is null
  ) lo on true
  left join lateral (
    -- Ventas VIVAS: una anulada o traspasada ya no es plata colocada de este
    -- eslabón (la traspasada vive en su sucesora).
    select count(*) as ventas,
           sum(private.to_bob(r.price_agreed, r.currency, r.project_id)) as valor_colocado_bob,
           max((r.confirmed_at at time zone 'America/La_Paz')::date) as ultima_venta
      from public.reservations r
     where r.project_id = p.id and r.confirmed_at is not null and r.status = 'confirmada'
  ) ve on true
  left join lateral (
    select sum(private.to_bob(i.amount - i.amount_paid, i.currency, i.project_id)) as por_cobrar_bob,
           sum(private.to_bob(
                 case when i.due_date < current_date then i.amount - i.amount_paid else 0 end,
                 i.currency, i.project_id)) as vencido_bob,
           count(distinct i.plan_id) as planes_activos
      from public.installments i
      join public.installment_plans pl on pl.id = i.plan_id
     where i.project_id = p.id and i.status in ('pendiente', 'parcial') and pl.status = 'activo'
  ) cc on true
  left join lateral (
    select sum(c.ingresos_bob) as ingresos_bob, sum(c.egresos_bob) as egresos_bob
      from public.v_monthly_cashflow c
     where c.project_id = p.id
  ) fi on true
  left join lateral (
    select count(*) as traspasos
      from public.reservations r
     where r.project_id = p.id and r.client_meta ? 'traspaso' and r.status = 'confirmada'
  ) tr on true
 where p.status <> 'archivado';

grant select on public.v_an_por_proyecto to authenticated;

-- ---- Integridad: los traspasos quedan bien enlazados o la suite lo grita.
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

  -- Cada traspaso: la vieja cerrada y apuntando a la nueva, la nueva viva
  -- apuntando a la vieja, y el lote en manos de la nueva. Un eslabón suelto
  -- acá es una cadena de propiedad rota.
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
end;
$fn$;

revoke execute on function public.verificar_integridad() from public, anon;
grant execute on function public.verificar_integridad() to authenticated, service_role;
