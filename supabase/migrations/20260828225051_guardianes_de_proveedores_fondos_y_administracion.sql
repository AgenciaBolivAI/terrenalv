-- SEIS GUARDIANES MÁS, para lo que se acaba de construir.
--
-- Todo esto se rompe en silencio: una deuda con proveedores que no coincide
-- con las facturas sin pagar, un fondo rendido de más, una administración que
-- alguien publicó por accidente. Nada de eso se ve mirando la pantalla hasta
-- que ya está mal, que es exactamente para lo que están los guardianes.
--
-- Los dos que comparan el libro contra las tablas (proveedores y fondos) solo
-- son ciertos porque `admin_save_voucher` tiene bloqueadas 2.01.04.010 y
-- 1.02.04.030: si se pudieran asentar a mano, el libro tendría movimientos que
-- ninguna factura ni ninguna entrega respalda.
do $$
declare v_def text; v_ancla text; v_nuevo text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'verificar_integridad';

  v_ancla := $ancla$  return query select 'no_se_asienta_en_cuentas_titulares'::text, (v_n = 0),
    format('%s movimiento(s) asentado(s) en una cuenta que tiene hijas', v_n);
end;$ancla$;

  if position(v_ancla in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA'
      using detail = 'verificar_integridad no termina como se esperaba.';
  end if;

  v_nuevo := $nuevo$  return query select 'no_se_asienta_en_cuentas_titulares'::text, (v_n = 0),
    format('%s movimiento(s) asentado(s) en una cuenta que tiene hijas', v_n);

  -- Una sola administración, en borrador y en bolivianos. Publicarla la
  -- pondría en el mapa y en la vidriera.
  select count(*) into v_n from public.projects
   where es_administracion and status = 'borrador' and currency = 'BOB';
  return query select 'la_administracion_existe_y_es_una'::text, (v_n = 1),
    format('%s administración(es) bien formada(s) — tiene que haber exactamente 1', v_n);

  -- Y no vende: no tiene lotes, ni reservas, ni terrenos madre.
  select (select count(*) from public.lots l
            join public.manzanas mz on mz.id = l.manzana_id
            join public.projects p on p.id = mz.project_id and p.es_administracion)
       + (select count(*) from public.reservations r
            join public.projects p on p.id = r.project_id and p.es_administracion)
       + (select count(*) from public.land_parcels lp
            join public.projects p on p.id = lp.project_id and p.es_administracion)
    into v_n;
  return query select 'la_administracion_no_vende'::text, (v_n = 0),
    format('%s cosa(s) de venta colgadas de la administración', v_n);

  -- Lo que el libro dice que se debe a proveedores es exactamente lo que está
  -- sin pagar.
  select coalesce(sum(haber), 0) - coalesce(sum(debe), 0) into v_d
    from public.v_libro_diario where cuenta = '2.01.04.010';
  select coalesce((select sum(e.amount_bob) from public.expenses e
                    where e.deleted_at is null and e.forma_pago = 'credito'
                      and e.pagado_el is null), 0)
       + coalesce((select sum(a.costo) from public.fixed_assets a
                    where a.forma_pago = 'credito' and a.pagado_el is null
                      and a.expense_id is null), 0)
    into v_h;
  return query select 'proveedores_por_pagar_cuadra'::text, (round(v_d,2) = round(v_h,2)),
    format('libro %s / sin pagar %s', round(v_d,2), round(v_h,2));

  -- El saldo de fondos por rendir del libro es la suma de los saldos por persona.
  select coalesce(sum(debe), 0) - coalesce(sum(haber), 0) into v_d
    from public.v_libro_diario where cuenta = '1.02.04.030';
  select coalesce((select sum(case tipo when 'entrega' then monto else -monto end)
                     from public.fondos_a_rendir where deleted_at is null), 0)
       - coalesce((select sum(amount_bob) from public.expenses
                    where deleted_at is null and forma_pago = 'fondos_por_rendir'), 0)
    into v_h;
  return query select 'fondos_por_rendir_cuadran'::text, (round(v_d,2) = round(v_h,2)),
    format('libro %s / por persona %s', round(v_d,2), round(v_h,2));

  -- Nadie rindió más de lo que se le entregó.
  select count(*) into v_n from (
    select e.id,
           coalesce((select sum(case f.tipo when 'entrega' then f.monto else -f.monto end)
                       from public.fondos_a_rendir f
                      where f.empleado_id = e.id and f.deleted_at is null), 0)
         - coalesce((select sum(x.amount_bob) from public.expenses x
                      where x.fondo_empleado_id = e.id and x.deleted_at is null
                        and x.forma_pago = 'fondos_por_rendir'), 0) as saldo
      from public.hr_empleados e) s
   where round(s.saldo, 2) < 0;
  return query select 'ningun_fondo_en_negativo'::text, (v_n = 0),
    format('%s persona(s) que rindieron más de lo que recibieron', v_n);

  -- Un activo nacido de un egreso tiene que haber capitalizado en la cuenta de
  -- su categoría; si no, la compra estaría asentada dos veces.
  select count(*) into v_n
    from public.fixed_assets a
    join public.asset_categories ac on ac.id = a.categoria_id
    join public.expenses e on e.id = a.expense_id
    left join public.expense_concepts ec on ec.id = e.concept_id
   where e.deleted_at is null
     and coalesce(ec.account_code, '') is distinct from coalesce(ac.cuenta_activo, '1249');
  return query select 'el_activo_de_egreso_capitaliza'::text, (v_n = 0),
    format('%s activo(s) cuyo egreso no capitalizó en su cuenta', v_n);
end;$nuevo$;

  execute replace(v_def, v_ancla, v_nuevo);
end $$;
