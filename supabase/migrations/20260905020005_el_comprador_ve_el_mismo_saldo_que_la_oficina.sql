-- La página del comprador (mi_plan_de_pago, la que abre con su código de
-- seguimiento) calculaba el saldo por su cuenta:
--
--   sum(amount_bob) where purpose in ('cuota','abono')
--
-- y eso está mal por los DOS lados a la vez:
--   · se olvida la SEÑA (purpose 'reserva'), así que el comprador ve Bs 1.000
--     más de deuda de la que la oficina le dice — pasa en cinco ventas vivas;
--   · suma el INTERÉS como si fuera capital, así que en la venta con plan
--     EDS-684B-B2SS ve Bs 406,67 MENOS de deuda de la real.
--
-- La regla de la casa está escrita hace tiempo y es una sola:
--     deuda = base_del_lote − capital_pagado
-- Es la que usa v_ventas, la que ve la oficina y la que manda. Acá se deja de
-- reimplementarla a mano y se llama a las mismas dos primitivas, con lo que el
-- papel del comprador y la pantalla del equipo no pueden volver a discrepar.

create or replace function public.mi_plan_de_pago(p_tracking_code text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $function$
declare
  v_res public.reservations%rowtype;
  v_plan public.installment_plans%rowtype;
  v_pagado numeric(14,2);
  v_saldo numeric(14,2);
begin
  select * into v_res from public.reservations
   where tracking_code = upper(btrim(coalesce(p_tracking_code, '')));
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if v_res.status <> 'confirmada' then return null; end if;

  -- Las MISMAS dos primitivas que usa la oficina. Nada de recalcular acá.
  v_saldo  := greatest(0, private.base_del_lote(v_res.id) - private.capital_pagado(v_res.id));
  v_pagado := private.capital_pagado(v_res.id)
              + coalesce((v_res.client_meta->'reportado'->>'abonado')::numeric, 0);

  select * into v_plan from public.installment_plans
   where reservation_id = v_res.id and status = 'activo';

  return jsonb_build_object(
    'tracking_code', v_res.tracking_code,
    'precio', v_res.price_agreed,
    'pagado', v_pagado,
    'saldo', v_saldo,
    'avance_pct', case when v_pagado + v_saldo > 0
                       then round(v_pagado * 100 / (v_pagado + v_saldo), 1) else 0 end,
    'con_plan', v_plan.id is not null,
    'plan', case when v_plan.id is null then null else jsonb_build_object(
      'cuota', v_plan.monthly_amount,
      'meses', v_plan.months,
      'inicial', v_plan.down_payment,
      'financiado', v_plan.financed_amount,
      'primer_vencimiento', v_plan.first_due_date,
      'cuotas_pagadas', (select count(*) from public.installments
                          where plan_id = v_plan.id and status = 'pagada'),
      'cuotas_vencidas', (select count(*) from public.installments
                           where plan_id = v_plan.id and status in ('pendiente','parcial')
                             and due_date < current_date),
      'monto_vencido', (select coalesce(sum(amount - amount_paid), 0) from public.installments
                         where plan_id = v_plan.id and status in ('pendiente','parcial')
                           and due_date < current_date),
      'proxima', (select jsonb_build_object('numero', number, 'vence', due_date,
                                            'monto', amount - amount_paid)
                    from public.installments
                   where plan_id = v_plan.id and status in ('pendiente','parcial')
                   order by due_date limit 1),
      'cuotas', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'numero', i.number, 'vence', i.due_date, 'monto', i.amount,
                 'pagado', i.amount_paid,
                 'estado', case when i.status = 'pagada' then 'pagada'
                                when i.status in ('pendiente','parcial') and i.due_date < current_date
                                  then 'vencida'
                                else i.status::text end,
                 'pagada_el', (i.paid_at at time zone 'America/La_Paz')::date)
               order by i.number)
          from public.installments i
         where i.plan_id = v_plan.id and i.status <> 'anulada'), '[]'::jsonb))
    end);
end;
$function$;

-- Guardián: el papel del comprador y la pantalla de la oficina dicen el mismo
-- saldo, venta por venta. Es el invariante que faltaba — el que habría cantado
-- las seis diferencias.
create or replace function private.saldos_que_no_coinciden()
returns table(tracking_code text, oficina numeric, comprador numeric)
language sql
stable
set search_path to 'public', 'private'
as $$
  select v.tracking_code,
         v.saldo,
         (public.mi_plan_de_pago(v.tracking_code)->>'saldo')::numeric
    from public.v_ventas v
   where v.compra_iniciada
     and round(v.saldo, 2)
         is distinct from round((public.mi_plan_de_pago(v.tracking_code)->>'saldo')::numeric, 2);
$$;

do $$
declare
  v_def text;
  v_ancla text := $ancla$  select count(*) into v_n from private.origenes_que_el_fiscal_rechaza();
  return query select 'el_fiscal_acepta_todo_origen_del_libro'::text, (v_n = 0),
    format('%s origen(es) del libro que el fiscal rechaza', v_n);$ancla$;
begin
  v_def := pg_get_functiondef('public.verificar_integridad()'::regprocedure);
  if position(v_ancla in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA: falta el ancla de origenes fiscales';
  end if;
  execute replace(v_def, v_ancla, v_ancla || $nuevo$

  -- Lo que el comprador lee en su página es lo que la oficina le diría.
  select count(*) into v_n from private.saldos_que_no_coinciden();
  return query select 'el_comprador_y_la_oficina_dicen_lo_mismo'::text, (v_n = 0),
    format('%s venta(s) donde el saldo del comprador no es el de la oficina', v_n);$nuevo$);
end $$;
