-- Suite de integridad, para correr ANTES de cada despliegue.
--
-- Vive en la base y no en el script a propósito: así la misma prueba la puede
-- correr el script de predeploy, el panel, o alguien pegándola en la consola
-- SQL, y todos obtienen exactamente el mismo veredicto.
--
-- Cada fila es una afirmación que tiene que ser verdadera SIEMPRE. Si alguna da
-- false, hay un error de datos o de código — no un aviso que se pueda ignorar.
create or replace function public.verificar_integridad()
returns table (prueba text, ok boolean, detalle text)
language plpgsql
stable
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_d numeric; v_h numeric; v_n int; v_a numeric; v_pp numeric; v_x numeric;
begin
  -- ---------------------------------------------------------------- LIBROS
  select coalesce(sum(debe),0), coalesce(sum(haber),0) into v_d, v_h
    from public.v_libro_diario;
  return query select 'diario_cuadra'::text, (v_d = v_h),
    format('debe %s / haber %s / diferencia %s', v_d, v_h, v_d - v_h);

  select count(*) into v_n from (
    select project_id from public.v_libro_diario
     group by project_id having sum(debe) <> sum(haber)) t;
  return query select 'diario_cuadra_por_urbanizacion'::text, (v_n = 0),
    format('%s urbanización(es) descuadrada(s)', v_n);

  -- El balance consolidado tiene que cerrar: Activo = Pasivo + Patrimonio.
  select coalesce(sum(case when seccion = 'Activo' then monto else 0 end), 0),
         coalesce(sum(case when seccion in ('Pasivo','Patrimonio') then monto else 0 end), 0)
    into v_a, v_pp from public.rep_balance_general(null, null);
  return query select 'balance_consolidado_cuadra'::text, (round(v_a,2) = round(v_pp,2)),
    format('activo %s / pasivo+patrimonio %s', round(v_a,2), round(v_pp,2));

  -- Y el de cada urbanización por separado.
  v_n := 0;
  for v_x in
    select p.id from public.projects p where p.status <> 'archivado'
  loop
    select coalesce(sum(case when seccion = 'Activo' then monto else 0 end), 0)
         - coalesce(sum(case when seccion in ('Pasivo','Patrimonio') then monto else 0 end), 0)
      into v_d from public.rep_balance_general(v_x::uuid, null);
    if round(v_d, 2) <> 0 then v_n := v_n + 1; end if;
  end loop;
  return query select 'balance_por_urbanizacion_cuadra'::text, (v_n = 0),
    format('%s urbanización(es) con balance descuadrado', v_n);

  -- El consolidado tiene que ser exactamente la suma de las partes: si no,
  -- una vista filtra por proyecto y otra no.
  select coalesce(sum(monto),0) into v_d
    from public.rep_estado_resultados(null, null, null) where seccion = 'Gastos';
  select coalesce(sum(t.g),0) into v_h from (
    select (select coalesce(sum(monto),0) from public.rep_estado_resultados(p.id, null, null)
             where seccion = 'Gastos') as g
      from public.projects p where p.status <> 'archivado') t;
  return query select 'consolidado_es_la_suma_de_partes'::text, (round(v_d,2) = round(v_h,2)),
    format('consolidado %s / suma %s', round(v_d,2), round(v_h,2));

  -- ------------------------------------------------------------ TESORERÍA
  select count(*) into v_n from public.v_tesoreria_saldos
   where round(saldo, 2) <> round(opening_balance + entradas - salidas, 2);
  return query select 'saldos_de_tesoreria_coherentes'::text, (v_n = 0),
    format('%s cuenta(s) donde saldo <> inicial + entradas - salidas', v_n);

  select count(*) into v_n from public.treasury_accounts t
   where not exists (select 1 from public.chart_of_accounts c where c.code = t.account_code);
  return query select 'cada_cuenta_tiene_su_cuenta_contable'::text, (v_n = 0),
    format('%s cuenta(s) de tesorería sin cuenta en el plan', v_n);

  -- --------------------------------------------------------- MULTIPROYECTO
  -- Toda urbanización no archivada aparece en la analítica, incluso sin ventas.
  select count(*) into v_n from public.projects p
   where p.status <> 'archivado'
     and not exists (select 1 from public.v_an_por_proyecto v where v.project_id = p.id);
  return query select 'todas_las_urbanizaciones_en_analitica'::text, (v_n = 0),
    format('%s urbanización(es) que no aparecen en el tablero', v_n);

  select count(*) into v_n from public.projects where currency <> 'BOB';
  return query select 'solo_bolivianos'::text, (v_n = 0),
    format('%s urbanización(es) en otra moneda', v_n);

  -- Las columnas normalizadas tienen que existir: sin ellas el consolidado
  -- vuelve a leer la moneda del proyecto sin avisar.
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

  -- ------------------------------------------------------------- INTEGRIDAD
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

  -- Un lote marcado vendido/reservado sin reserva viva es una vitrina mintiendo.
  select count(*) into v_n from public.lots l
   where l.deleted_at is null and l.status in ('reservado','vendido')
     and (l.active_reservation_id is null
          or not exists (select 1 from public.reservations r
                          where r.id = l.active_reservation_id
                            and r.status in ('pendiente_pago','en_verificacion','confirmada')));
  return query select 'lotes_ocupados_tienen_reserva_viva'::text, (v_n = 0),
    format('%s lote(s) bloqueado(s) sin reserva que lo justifique', v_n);

  -- Una reserva con comprobante subido NO puede tener el reloj corriendo.
  select count(*) into v_n from public.reservations
   where status = 'en_verificacion'
     and (hold_expires_at is not null or retry_expires_at is not null);
  return query select 'comprobante_subido_pausa_el_reloj'::text, (v_n = 0),
    format('%s reserva(s) en verificación con vencimiento activo', v_n);

  -- Cada pago aprobado tiene que estar en el libro.
  select count(*) into v_n from public.payments p
   where p.status = 'aprobado' and p.verified_at is not null
     and not exists (select 1 from public.v_libro_diario d where d.origen_id = p.id);
  return query select 'todo_pago_aprobado_esta_en_el_libro'::text, (v_n = 0),
    format('%s pago(s) aprobado(s) fuera del libro', v_n);
end;
$fn$;

revoke execute on function public.verificar_integridad() from public, anon;
grant execute on function public.verificar_integridad() to authenticated, service_role;
