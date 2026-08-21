create or replace function private.notify_overdue_installments()
returns int
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  r record;
  v_n int := 0;
begin
  for r in
    select
      i.project_id,
      count(*)                                   as cuotas,
      count(distinct i.plan_id)                  as clientes,
      sum(i.amount - i.amount_paid)              as monto,
      max(current_date - i.due_date)             as peor_atraso
    from public.installments i
    join public.installment_plans p on p.id = i.plan_id
   where i.status in ('pendiente', 'parcial')
     and i.due_date < current_date
     and p.status = 'activo'
   group by i.project_id
  loop
    perform private.notify(
      r.project_id,
      'sistema',
      case when r.peor_atraso >= 30 then 'alta' else 'media' end,
      format('%s cuota(s) vencida(s) — Bs %s', r.cuotas, to_char(r.monto, 'FM999G999G990D00')),
      format('%s cliente(s) con pagos atrasados. El mas antiguo lleva %s dia(s).',
             r.clientes, r.peor_atraso),
      'installment', null,
      jsonb_build_object('cuotas', r.cuotas, 'clientes', r.clientes,
                         'monto', r.monto, 'peor_atraso', r.peor_atraso));
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$fn$;

select cron.schedule('notify_overdue', '0 13 * * *',
  $cron$ select private.notify_overdue_installments(); $cron$);
