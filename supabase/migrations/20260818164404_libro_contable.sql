create table if not exists public.chart_of_accounts (
  code      text primary key,
  name      text not null,
  kind      text not null check (kind in ('activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto')),
  sort_order int not null default 0
);

insert into public.chart_of_accounts (code, name, kind, sort_order) values
  ('1111', 'Caja y Bancos',                 'activo',  10),
  ('1131', 'Cuentas por Cobrar Clientes',   'activo',  20),
  ('2131', 'Anticipos de Clientes',         'pasivo',  30),
  ('4111', 'Ventas de Terrenos',            'ingreso', 40),
  ('5111', 'Costos de Obra',                'gasto',   50),
  ('5211', 'Comisiones de Venta',           'gasto',   60),
  ('5221', 'Sueldos y Cargas Sociales',     'gasto',   70),
  ('5311', 'Publicidad y Marketing',        'gasto',   80),
  ('5411', 'Gastos de Administración',      'gasto',   90),
  ('5511', 'Impuestos y Tasas',             'gasto',  100),
  ('5611', 'Gastos Financieros',            'gasto',  110),
  ('5911', 'Otros Gastos',                  'gasto',  120)
on conflict (code) do nothing;

alter table public.chart_of_accounts enable row level security;
revoke insert, update, delete, truncate on public.chart_of_accounts from anon, authenticated;
create policy coa_team_read on public.chart_of_accounts
  for select to authenticated using (private.is_team());

create or replace view public.v_libro_diario
with (security_invoker = on) as
select
  p.project_id,
  (p.verified_at at time zone 'America/La_Paz')::date as fecha,
  'PAGO-' || p.reference_code                          as comprobante,
  case when p.purpose = 'cuota' then 'Cobro de cuota' else 'Cobro de seña / reserva' end
    || ' — ' || r.buyer_full_name || ' (' || r.tracking_code || ')'      as glosa,
  '1111'::text        as cuenta,
  p.amount_bob        as debe,
  0::numeric          as haber,
  p.id                as origen_id,
  'pago'::text        as origen
from public.payments p
join public.reservations r on r.id = p.reservation_id
where p.status = 'aprobado' and p.verified_at is not null

union all

select
  p.project_id,
  (p.verified_at at time zone 'America/La_Paz')::date,
  'PAGO-' || p.reference_code,
  case when p.purpose = 'cuota' then 'Cobro de cuota' else 'Cobro de seña / reserva' end
    || ' — ' || r.buyer_full_name || ' (' || r.tracking_code || ')',
  case when p.purpose = 'cuota' then '1131' else '2131' end,
  0::numeric,
  p.amount_bob,
  p.id,
  'pago'
from public.payments p
join public.reservations r on r.id = p.reservation_id
where p.status = 'aprobado' and p.verified_at is not null

union all

select
  e.project_id,
  e.incurred_on,
  'EGR-' || left(replace(e.id::text, '-', ''), 10),
  e.description || coalesce(' — ' || e.supplier, ''),
  case e.category
    when 'obra'           then '5111'
    when 'comisiones'     then '5211'
    when 'sueldos'        then '5221'
    when 'publicidad'     then '5311'
    when 'administracion' then '5411'
    when 'impuestos'      then '5511'
    when 'financiero'     then '5611'
    else '5911'
  end,
  e.amount_bob,
  0::numeric,
  e.id,
  'egreso'
from public.expenses e
where e.deleted_at is null

union all

select
  e.project_id,
  e.incurred_on,
  'EGR-' || left(replace(e.id::text, '-', ''), 10),
  e.description || coalesce(' — ' || e.supplier, ''),
  '1111',
  0::numeric,
  e.amount_bob,
  e.id,
  'egreso'
from public.expenses e
where e.deleted_at is null;

create or replace view public.v_libro_mayor
with (security_invoker = on) as
select
  d.project_id,
  d.cuenta,
  c.name  as cuenta_nombre,
  c.kind  as tipo,
  c.sort_order,
  sum(d.debe)  as debe,
  sum(d.haber) as haber,
  case when c.kind in ('activo', 'gasto')
       then sum(d.debe) - sum(d.haber)
       else sum(d.haber) - sum(d.debe)
  end as saldo,
  min(d.fecha) as desde,
  max(d.fecha) as hasta
from public.v_libro_diario d
join public.chart_of_accounts c on c.code = d.cuenta
group by d.project_id, d.cuenta, c.name, c.kind, c.sort_order;

grant select on public.v_libro_diario, public.v_libro_mayor, public.chart_of_accounts to authenticated;
