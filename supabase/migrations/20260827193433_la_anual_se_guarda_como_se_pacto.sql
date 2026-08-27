-- La tasa anual se guarda COMO SE PACTÓ.
--
-- Se estaba derivando de vuelta desde la mensual redondeada —1,666667 × 12—
-- y el plan quedaba diciendo «20,000004 % anual». Lo pactado fue 20, y 20 es
-- lo que tiene que decir el contrato. La mensual sigue derivándose de ella.
do $$
declare
  v_src text;
  v_old text := $blk$round(v_tasa * 12, 6), v_tasa, v_first, p_note, v_actor)$blk$;
  v_new text := $blk$coalesce(nullif(p_annual_interest_pct, 0), round(v_tasa * 12, 6)),
     v_tasa, v_first, p_note, v_actor)$blk$;
begin
  select pg_get_functiondef(oid) into v_src
  from pg_proc where proname='admin_create_installment_plan' and pronamespace='public'::regnamespace;
  if position(v_old in v_src) = 0 then
    raise exception 'no encontré el insert del plan';
  end if;
  if (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'el insert aparece más de una vez: parche ambiguo';
  end if;
  execute replace(v_src, v_old, v_new);
end $$;

-- Los planes ya cargados: la anual, a dos decimales, que es como se pacta.
update public.installment_plans
   set annual_interest_pct = round(annual_interest_pct, 2)
 where annual_interest_pct is not null
   and annual_interest_pct <> round(annual_interest_pct, 2);
