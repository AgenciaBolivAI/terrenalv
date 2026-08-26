-- 3. El guardián de cuotas parejas ignoraba los planes con interés. Ahí la
--    última cuota difiere por matemática: el medio centavo de redondeo de la
--    cuota francesa se CAPITALIZA mes a mes, hasta e·((1+i)^n − 1)/i. Eso no
--    es un bug — es la cota de la aritmética — pero una diferencia MAYOR que
--    esa cota sí es un bug, y hasta hoy nadie la habría visto.
--
-- Mismo método quirúrgico: se reemplaza solo el bloque del chequeo y se
-- valida que el parche agarró.
do $$
declare
  v_def text;
  v_viejo text;
  v_nuevo text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'verificar_integridad';

  v_viejo :=
'  select count(*) into v_n from (
    select i.plan_id
      from public.installments i
      join public.installment_plans pl on pl.id = i.plan_id
     where pl.status = ''activo''
       and coalesce(pl.monthly_interest_pct, 0) = 0
       and i.status in (''pendiente'',''parcial'')
     group by i.plan_id
    having max(i.amount) - min(i.amount) > greatest(0.02, 0.01 * count(*))
  ) t;';

  if position(v_viejo in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA: no encuentro el bloque de cuotas_parejas';
  end if;

  v_nuevo :=
'  select count(*) into v_n from (
    select i.plan_id
      from public.installments i
      join public.installment_plans pl on pl.id = i.plan_id
     where pl.status = ''activo''
       and i.status in (''pendiente'',''parcial'')
     group by i.plan_id, coalesce(pl.monthly_interest_pct, 0)
    having max(i.amount) - min(i.amount) > greatest(0.02,
      case when coalesce(pl.monthly_interest_pct, 0) = 0
           then 0.01 * count(*)
           -- Con interés, el redondeo de la cuota francesa se capitaliza:
           -- la cota es e·((1+i)^n − 1)/i con e = medio centavo, más el
           -- centaveo por cuota de siempre.
           else 0.005 * (power(1 + pl.monthly_interest_pct / 100, count(*)) - 1)
                / (pl.monthly_interest_pct / 100) + 0.01 * count(*)
      end)
  ) t;';

  v_def := replace(v_def, v_viejo, v_nuevo);
  execute v_def;
end $$;
