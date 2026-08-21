-- Saldo de cada banco y cada caja.
--
-- Saldo inicial + todo lo que pasó por SU cuenta contable. Es la cifra que se
-- compara contra el extracto del banco: si no da, hay algo sin registrar.
--
-- Suma todos los proyectos a propósito: una cuenta bancaria es de Terrenalv,
-- no de una urbanización. La plata está ahí venga de donde venga.
create or replace view public.v_tesoreria_saldos
with (security_invoker = true) as
select t.id, t.kind, t.name, t.bank_name, t.account_number, t.currency,
       t.account_code, t.is_active, t.opening_balance, t.opening_date,
       coalesce(m.debe, 0)  as entradas,
       coalesce(m.haber, 0) as salidas,
       t.opening_balance + coalesce(m.debe, 0) - coalesce(m.haber, 0) as saldo,
       m.ultimo_movimiento,
       coalesce(m.movimientos, 0) as movimientos
  from public.treasury_accounts t
  left join lateral (
    select sum(d.debe) as debe, sum(d.haber) as haber,
           max(d.fecha) as ultimo_movimiento, count(*) as movimientos
      from public.v_libro_diario d
     where d.cuenta = t.account_code
  ) m on true;

-- Egresos por categoría y por mes: para ver en qué se va la plata y si una
-- categoría se está disparando.
create or replace view public.v_an_egresos_categoria
with (security_invoker = true) as
select e.project_id,
       date_trunc('month', e.incurred_on)::date as mes,
       e.category,
       sum(e.amount_bob) as total,
       count(*) as cantidad
  from public.expenses e
 where e.deleted_at is null
 group by 1, 2, 3;

-- Ranking de proveedores. Usa el contacto del directorio cuando existe y cae al
-- texto libre para los egresos viejos, así el histórico no desaparece.
create or replace view public.v_an_proveedores
with (security_invoker = true) as
select e.project_id,
       coalesce(c.name, nullif(btrim(e.supplier), ''), 'Sin proveedor') as proveedor,
       c.id as contact_id,
       c.tax_id,
       sum(e.amount_bob) as total,
       count(*) as egresos,
       min(e.incurred_on) as primero,
       max(e.incurred_on) as ultimo
  from public.expenses e
  left join public.contacts c on c.id = e.contact_id
 where e.deleted_at is null
 group by 1, 2, 3, 4;

grant select on public.v_tesoreria_saldos, public.v_an_egresos_categoria, public.v_an_proveedores
  to authenticated;
