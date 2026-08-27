-- El plan EDS-684B-B2SS se armó con «1,67» escrito a mano en el campo que
-- entonces pedía la tasa MENSUAL. Eso es 20,04 % anual, y por eso la hoja
-- decía 20,04 %: la cifra era correcta, el plan estaba mal pactado. Lo que se
-- quiso pactar —y lo que cobra la planilla del equipo— es 20 % anual.
--
-- Se rehace el cronograma a 20 % anual exacto (1,666667 % mensual) sobre los
-- mismos Bs 24.400 financiados: cuota Bs 646,45, igual que RepCarCons. El pago
-- de Bs 646 vuelve a su cuota 1 con el interés que le toca en el cronograma
-- nuevo (Bs 406,67 sobre 24.400). Probado en transacción revertida antes de
-- aplicar: las 34 pruebas de integridad quedan en verde.
--
-- Solo toca ESTE plan: es el único con interés distinto de cero en la base.
do $$
declare
  v_plan uuid := '76d32e6f-4af9-4d17-b266-7c8d01f1dff2';
  v_pago uuid := '90a68a6f-bbfd-4ca0-b941-a9c33e8dc876';
  v_proj uuid; v_first date := '2026-09-27';
  v_tasa numeric := 20/12.0; v_cap numeric := 24400; v_n int := 60;
  v_cuota numeric; v_pend numeric; v_int numeric; v_capm numeric; v_i int;
  v_c1 record; v_fallas int;
begin
  -- Si el plan ya no está como se lo dejó, no se toca nada.
  perform 1 from installment_plans
   where id = v_plan and status = 'activo' and monthly_interest_pct = 1.670000;
  if not found then
    raise notice 'el plan ya no está en el estado esperado: no se toca';
    return;
  end if;

  select project_id into v_proj from installment_plans where id = v_plan;
  v_cuota := round(v_cap * (v_tasa/100) / (1 - power(1 + v_tasa/100, -v_n)), 2);

  delete from payment_allocations where payment_id = v_pago;
  delete from installments where plan_id = v_plan;

  v_pend := v_cap;
  for v_i in 1..v_n loop
    v_int := round(v_pend * v_tasa/100, 2);
    v_capm := case when v_i < v_n then round(v_cuota - v_int, 2) else v_pend end;
    v_pend := round(v_pend - v_capm, 2);
    insert into installments (plan_id, project_id, number, due_date, amount, interes, currency)
    values (v_plan, v_proj, v_i, (v_first + (v_i - 1) * interval '1 month')::date,
            round(v_capm + v_int, 2), v_int, 'BOB');
  end loop;

  update installment_plans
     set monthly_interest_pct = round(v_tasa, 6), annual_interest_pct = 20,
         monthly_amount = v_cuota, financed_amount = v_cap, base_amount = v_cap,
         down_payment = 0, months = v_n, first_due_date = v_first, updated_at = now()
   where id = v_plan;

  select i.id, i.interes into v_c1 from installments i where i.plan_id = v_plan and i.number = 1;
  update payments set interest_bob = least(v_c1.interes, 646) where id = v_pago;
  insert into payment_allocations (payment_id, installment_id, amount) values (v_pago, v_c1.id, 646);

  select count(*) into v_fallas from verificar_integridad() where not ok;
  if v_fallas > 0 then
    raise exception 'la reparación dejó % prueba(s) de integridad en rojo', v_fallas;
  end if;
end $$;

-- Y al reprogramar, la anual se guarda a dos decimales: 1,666667 × 12 daba
-- 20,000004, que en pantalla se lee como un error de tipeo.
do $$
declare v_src text;
begin
  select pg_get_functiondef(oid) into v_src
  from pg_proc where proname='admin_editar_plan' and pronamespace='public'::regnamespace;
  execute replace(v_src, 'annual_interest_pct = round(v_tasa * 12, 6),',
                         'annual_interest_pct = round(v_tasa * 12, 2),');
end $$;
