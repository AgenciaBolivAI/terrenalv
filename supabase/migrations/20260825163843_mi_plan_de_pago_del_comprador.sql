-- «Mi plan de pago» para el comprador: su cronograma completo, cuota por
-- cuota, con lo pagado, lo que viene y lo vencido. Se abre con su código de
-- seguimiento — la misma llave de siempre — así que no hace falta cuenta.
--
-- Terrenalv no manda estados de cuenta por WhatsApp uno por uno: el comprador
-- entra y ve lo mismo que ve la oficina.
create or replace function public.mi_plan_de_pago(p_tracking_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_res public.reservations%rowtype;
  v_plan public.installment_plans%rowtype;
  v_pagado numeric(14,2);
  v_saldo numeric(14,2);
  v_base numeric(14,2);
begin
  select * into v_res from public.reservations
   where tracking_code = upper(btrim(coalesce(p_tracking_code, '')));
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if v_res.status <> 'confirmada' then return null; end if;

  v_base := coalesce((v_res.client_meta->'reportado'->>'deuda')::numeric, v_res.price_agreed);
  select coalesce(sum(x.amount_bob), 0) into v_pagado
    from public.payments x
   where x.reservation_id = v_res.id and x.status = 'aprobado'
     and x.purpose in ('cuota','abono');
  v_saldo := greatest(0, v_base - v_pagado);
  v_pagado := v_pagado + coalesce((v_res.client_meta->'reportado'->>'abonado')::numeric, 0);

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
$fn$;

revoke execute on function public.mi_plan_de_pago(text) from public;
grant execute on function public.mi_plan_de_pago(text) to anon, authenticated, service_role;
