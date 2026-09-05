-- «Pagado» en la pantalla de Planes tiene que ser exactamente la suma de lo
-- pagado en las cuotas que ese plan muestra. Hoy NO lo es: `v_planes.pagado`
-- suma `amount_paid` de TODAS las cuotas, anuladas incluidas, mientras que el
-- resto de la vista —cuántas cuotas hay, cuántas están pagadas, el saldo, el
-- vencido— filtra las anuladas.
--
-- El resultado que ve la oficina: «Pagado Bs 646,00 · 0 de 60 cuotas pagadas»
-- y, al abrir el plan, las 60 cuotas pendientes. La cifra dice una cosa y la
-- lista que hay detrás dice otra, que es justo lo que no puede pasar.
--
-- Este guardián nace EN ROJO con el dato real: no hace falta señuelo.
create or replace function private.planes_con_pagado_que_no_es_de_sus_cuotas()
returns table(plan_id uuid, pagado_vista numeric, pagado_cuotas numeric)
language sql stable
set search_path to 'public', 'private', 'pg_temp'
as $function$
  select v.plan_id,
         round(v.pagado, 2),
         round(coalesce(c.pagado_vivas, 0), 2)
    from public.v_planes v
    left join lateral (
      select sum(i.amount_paid) as pagado_vivas
        from public.installments i
       where i.plan_id = v.plan_id
         and i.status <> 'anulada'::installment_status
    ) c on true
   where round(v.pagado, 2) <> round(coalesce(c.pagado_vivas, 0), 2);
$function$;

do $$
declare
  v_def text;
  v_anchor text := $a$  -- Sumas y Saldos y el Balance General dicen el mismo saldo por cuenta.$a$;
  v_extra text := $x$  -- Lo «pagado» del plan es lo que dicen sus propias cuotas.
  select count(*) into v_n from private.planes_con_pagado_que_no_es_de_sus_cuotas();
  return query select 'lo_pagado_del_plan_es_lo_de_sus_cuotas'::text, (v_n = 0),
    format('%s plan(es) donde «pagado» no coincide con la suma de sus cuotas', v_n);

$x$;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'verificar_integridad';
  if position(v_anchor in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA: no se encontró el ancla';
  end if;
  if position('lo_pagado_del_plan_es_lo_de_sus_cuotas' in v_def) > 0 then
    raise exception 'PARCHE_NO_AGARRA: el guardián ya estaba';
  end if;
  execute replace(v_def, v_anchor, v_extra || v_anchor);
end $$;
