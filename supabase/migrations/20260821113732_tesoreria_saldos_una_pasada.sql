-- Saldos de tesorería en una sola pasada del libro.
--
-- La versión anterior usaba un lateral por cuenta: el planificador empujaba el
-- filtro adentro de cada rama de la unión, pero igual recorría pagos y
-- reservas una vez por cada banco y cada caja. Agrupar primero y unir después
-- recorre el libro UNA vez, sin importar cuántas cuentas haya.
create or replace view public.v_tesoreria_saldos
with (security_invoker = true) as
with movimientos as (
  select d.cuenta,
         sum(d.debe)  as debe,
         sum(d.haber) as haber,
         max(d.fecha) as ultimo_movimiento,
         count(*)     as movimientos
    from public.v_libro_diario d
   group by d.cuenta
)
select t.id, t.kind, t.name, t.bank_name, t.account_number, t.currency,
       t.account_code, t.is_active, t.opening_balance, t.opening_date,
       coalesce(m.debe, 0)  as entradas,
       coalesce(m.haber, 0) as salidas,
       t.opening_balance + coalesce(m.debe, 0) - coalesce(m.haber, 0) as saldo,
       m.ultimo_movimiento,
       coalesce(m.movimientos, 0) as movimientos
  from public.treasury_accounts t
  left join movimientos m on m.cuenta = t.account_code;

grant select on public.v_tesoreria_saldos to authenticated;
