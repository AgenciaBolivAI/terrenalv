-- EL INTERÉS SE PACTA ANUAL.
--
-- El vendedor habla en años («20% anual»), no en meses. El motor cobra
-- mensualmente sobre el saldo, así que la tasa mensual se DERIVA: anual / 12.
-- Es la conversión nominal, la que usa la plaza — y cuadra con lo que ya hay
-- cargado: el plan de EDS-684B-B2SS está al 1,67% mensual, que es 20% anual.
--
-- `p_annual_interest_pct` existía en la firma desde siempre y no se usaba para
-- nada: se guardaba en la fila y el cálculo la ignoraba. Ahora manda cuando no
-- se especifica la mensual, y la fila guarda SIEMPRE las dos, coherentes entre
-- sí, para que cualquier pantalla pueda decir «20% anual (1,67% mensual)» sin
-- volver a calcular nada.
--
-- Precedencia, para no romper a nadie: mensual explícita > anual / 12 >
-- lo que manda la clasificación del lote por su precio.
do $$
declare
  v_src text;
  v_old text := $blk$  if p_monthly_interest_pct is null then
    v_cond := public.condiciones_financiamiento(v_res.project_id, v_res.price_agreed);
    v_tasa := coalesce((v_cond->>'interes_mensual_pct')::numeric, 0);
  else
    v_tasa := p_monthly_interest_pct;
  end if;$blk$;
  v_new text := $blk$  if p_monthly_interest_pct is not null then
    v_tasa := p_monthly_interest_pct;
  elsif coalesce(p_annual_interest_pct, 0) > 0 then
    -- Lo que pacta el vendedor es ANUAL; el motor cobra por mes sobre el
    -- saldo, así que la mensual se deriva. 20 anual ⇒ 1,667 mensual.
    v_tasa := round(p_annual_interest_pct / 12.0, 3);
  else
    v_cond := public.condiciones_financiamiento(v_res.project_id, v_res.price_agreed);
    v_tasa := coalesce((v_cond->>'interes_mensual_pct')::numeric, 0);
  end if;$blk$;
begin
  select pg_get_functiondef(oid) into v_src
  from pg_proc where proname='admin_create_installment_plan' and pronamespace='public'::regnamespace;
  if position(v_old in v_src) = 0 then
    raise exception 'no encontré el bloque de la tasa en admin_create_installment_plan';
  end if;
  if (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'el bloque aparece más de una vez: parche ambiguo';
  end if;

  -- La fila guarda las dos tasas, y la anual se deriva de la que se usó de
  -- verdad: así nunca pueden contradecirse en pantalla.
  v_src := replace(v_src,
    'coalesce(p_annual_interest_pct, 0), v_tasa, v_first, p_note, v_actor)',
    'round(v_tasa * 12, 3), v_tasa, v_first, p_note, v_actor)');

  execute replace(v_src, v_old, v_new);
end $$;

-- Al reprogramar, la anual sigue a la mensual que quedó.
do $$
declare
  v_src text;
  v_old text := $blk$     set monthly_interest_pct = v_tasa,$blk$;
  v_new text := $blk$     set monthly_interest_pct = v_tasa,
         annual_interest_pct = round(v_tasa * 12, 3),$blk$;
begin
  select pg_get_functiondef(oid) into v_src
  from pg_proc where proname='admin_editar_plan' and pronamespace='public'::regnamespace;
  if position(v_old in v_src) = 0 then
    raise exception 'no encontré el update en admin_editar_plan';
  end if;
  if (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'el update aparece más de una vez: parche ambiguo';
  end if;
  execute replace(v_src, v_old, v_new);
end $$;

-- Los planes que ya existen quedan coherentes: su anual pasa a ser la mensual
-- por doce, que es lo que de verdad se les está cobrando.
update public.installment_plans
   set annual_interest_pct = round(coalesce(monthly_interest_pct, 0) * 12, 3)
 where coalesce(annual_interest_pct, 0) is distinct from round(coalesce(monthly_interest_pct, 0) * 12, 3);
