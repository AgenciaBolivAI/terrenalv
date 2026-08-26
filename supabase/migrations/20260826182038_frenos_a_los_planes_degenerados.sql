-- Cuatro frenos que faltaban, encontrados por la verificación adversaria.
--
-- a) Quedaba viva la firma VIEJA de admin_create_installment_plan (7
--    argumentos): cualquier llamada sin el interés mensual moría con
--    «function is not unique». La misma clase de bug que ya pasó con
--    mark_sold_offline. Fuera.
--
-- b) Con interés alto y plazo largo, la cuota francesa redondeada empataba
--    con el interés del mes: capital 0,00 todos los meses, y TODO el terreno
--    en una cuota globo al final. La función lo aceptaba sin chistar. Ahora
--    exige que la primera cuota amortice al menos un centavo, o rechaza con
--    «acortá el plazo o bajá la tasa».
--
-- c) El tope de 480 meses no regía para el plazo DERIVADO en los abonos:
--    un caso de centavos derivaba 114.960 meses, insertaba esas filas y
--    recién moría — y de paso BLOQUEABA el cobro legítimo. Tope en todos
--    los caminos; si el resto es tan chico que no se reparte, queda UNA
--    cuota final por el total.
--
-- d) La cuota con interés podía redondear a 0,00 y morir contra la tabla.
--    Ahora es un error de negocio, dicho en cristiano.

-- ---------- a) fuera la firma vieja ----------------------------------------
drop function if exists public.admin_create_installment_plan(
  uuid, integer, numeric, numeric, date, numeric, text);

-- ---------- b) y d) el interés tiene que amortizar --------------------------
do $$
declare
  v_def text;
  v_guardia text;
begin
  -- CREATE: después de calcular la cuota francesa
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_create_installment_plan';

  v_guardia := 'v_cuota := round(v_financed * (v_tasa/100)
                     / (1 - power(1 + v_tasa/100, -p_months)), 2);';
  if position(v_guardia in v_def) = 0 then
    raise exception 'PARCHE_CREATE_NO_AGARRA';
  end if;
  v_def := replace(v_def, v_guardia, v_guardia || '
    if v_cuota <= 0 then
      raise exception ''INVALID_MONTHS''
        using detail = ''el monto es tan chico que la cuota redondea a cero'';
    end if;
    -- Si la cuota apenas cubre el interés, el capital nunca baja: todo el
    -- terreno quedaría en una cuota globo al final. Eso no es un plan.
    if round(v_cuota - round(v_financed * v_tasa / 100, 2), 2) < 0.01 then
      raise exception ''PLAZO_NO_AMORTIZA''
        using detail = format(''con %s%% mensual y %s meses, la cuota %s apenas cubre el interés del primer mes (%s): acortá el plazo o bajá la tasa'',
                              v_tasa, p_months, v_cuota, round(v_financed * v_tasa / 100, 2));
    end if;');
  execute v_def;

  -- EDITAR: mismo freno
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_editar_plan';

  v_guardia := 'v_cuota := round(v_pendiente * (v_tasa/100) / (1 - power(1 + v_tasa/100, -v_meses)), 2);';
  if position(v_guardia in v_def) = 0 then
    raise exception 'PARCHE_EDITAR_NO_AGARRA';
  end if;
  v_def := replace(v_def, v_guardia, v_guardia || '
    if v_cuota <= 0 then
      raise exception ''INVALID_MONTHS''
        using detail = ''el monto es tan chico que la cuota redondea a cero'';
    end if;
    if round(v_cuota - round(v_pendiente * v_tasa / 100, 2), 2) < 0.01 then
      raise exception ''PLAZO_NO_AMORTIZA''
        using detail = format(''con %s%% mensual y %s meses, la cuota %s apenas cubre el interés del primer mes (%s): acortá el plazo o bajá la tasa'',
                              v_tasa, v_meses, v_cuota, round(v_pendiente * v_tasa / 100, 2));
    end if;');
  execute v_def;

  -- ABONO: freno al interés + topes al plazo derivado + resto chico = 1 cuota
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_register_cuota_payment'
     and pg_get_function_identity_arguments(p.oid) like '%p_recalculo%';

  v_guardia := 'v_cuota := round(v_nuevo * (v_tasa/100) / (1 - power(1 + v_tasa/100, -v_meses)), 2);';
  if position(v_guardia in v_def) = 0 then
    raise exception 'PARCHE_ABONO_FRANCES_NO_AGARRA';
  end if;
  v_def := replace(v_def, v_guardia, v_guardia || '
      if v_cuota <= 0 or round(v_cuota - round(v_nuevo * v_tasa / 100, 2), 2) < 0.01 then
        raise exception ''PLAZO_NO_AMORTIZA''
          using detail = format(''con %s%% mensual y %s meses la cuota no amortiza: acortá el plazo'',
                                v_tasa, v_meses);
      end if;');

  -- tope 480 en el plazo derivado de conservar la cuota
  if position('v_meses := greatest(1, round(v_nuevo / v_cuota)::int);' in v_def) = 0 then
    raise exception 'PARCHE_ABONO_PLAZO_NO_AGARRA';
  end if;
  v_def := replace(v_def,
    'v_meses := greatest(1, round(v_nuevo / v_cuota)::int);',
    'v_meses := least(480, greatest(1, round(v_nuevo / v_cuota)::int));');

  if position('v_meses := greatest(1, round(
            ln(v_cuota / (v_cuota - v_nuevo * v_tasa / 100)) / ln(1 + v_tasa / 100))::int);' in v_def) > 0 then
    v_def := replace(v_def,
      'v_meses := greatest(1, round(
            ln(v_cuota / (v_cuota - v_nuevo * v_tasa / 100)) / ln(1 + v_tasa / 100))::int);',
      'v_meses := least(480, greatest(1, round(
            ln(v_cuota / (v_cuota - v_nuevo * v_tasa / 100)) / ln(1 + v_tasa / 100))::int));');
  else
    -- la variante con ceil de la versión anterior
    if position('v_meses := greatest(1, ceil(
            ln(v_cuota / (v_cuota - v_nuevo * v_tasa / 100)) / ln(1 + v_tasa / 100))::int);' in v_def) = 0 then
      raise exception 'PARCHE_ABONO_LN_NO_AGARRA';
    end if;
    v_def := replace(v_def,
      'v_meses := greatest(1, ceil(
            ln(v_cuota / (v_cuota - v_nuevo * v_tasa / 100)) / ln(1 + v_tasa / 100))::int);',
      'v_meses := least(480, greatest(1, round(
            ln(v_cuota / (v_cuota - v_nuevo * v_tasa / 100)) / ln(1 + v_tasa / 100))::int));');
  end if;

  -- resto de centavos: UNA cuota final, no 114.960 meses
  if position('v_meses := greatest(1, ceil(v_nuevo / 0.01)::int);
          v_cuota := round(v_nuevo / v_meses, 2);' in v_def) = 0 then
    raise exception 'PARCHE_ABONO_FALLBACK_NO_AGARRA';
  end if;
  v_def := replace(v_def,
    'v_meses := greatest(1, ceil(v_nuevo / 0.01)::int);
          v_cuota := round(v_nuevo / v_meses, 2);',
    '-- Un resto tan chico que no se reparte: queda una sola cuota final.
          v_meses := 1;
          v_cuota := v_nuevo;');

  execute v_def;
end $$;

select count(*) as fallas from public.verificar_integridad() where not ok;
