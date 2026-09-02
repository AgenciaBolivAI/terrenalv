-- La contadora pidió ver las VENTAS en el tablero: cuánto se vendió, cuánto
-- entró y cuánto falta cobrar. Las cifras salen de v_ventas con el MISMO
-- criterio que usa la pantalla de Ventas (`compra_iniciada`): una reserva
-- confirmada a la que nadie pagó la inicial todavía no es plata vendida ni
-- saldo por cobrar. Si el tablero contara distinto, la casilla y la lista que
-- abre dirían números distintos.
--
-- Por qué una función y no traer las filas y sumarlas en el navegador:
-- **PostgREST corta toda respuesta en 1.000 filas**. Hoy hay 22 ventas y no se
-- notaría, pero apenas una urbanización pase el millar el tablero empezaría a
-- sumar de menos EN SILENCIO — que es la peor clase de error de todas. Sumando
-- en la base no hay tope que valga. (La pantalla de Ventas ya se topó con
-- esto: por eso pagina.)
--
-- Sin security definer a propósito: corre con los permisos de quien la llama,
-- igual que la consulta directa que reemplaza.

create or replace function public.rep_tablero_ventas(p_project_id uuid)
returns table(
  ventas integer,
  valor numeric,
  cobrado numeric,
  saldo numeric,
  con_saldo integer,
  cuotas_vencidas integer,
  monto_vencido numeric
)
language sql
stable
set search_path to 'public', 'extensions'
as $$
  select
    coalesce(v.ventas, 0),
    coalesce(v.valor, 0),
    coalesce(v.cobrado, 0),
    coalesce(v.saldo, 0),
    coalesce(v.con_saldo, 0),
    coalesce(c.cuotas_vencidas, 0),
    coalesce(c.monto_vencido, 0)
  from (
    select count(*)::int                                   as ventas,
           round(sum(price_agreed), 2)                     as valor,
           round(sum(pagado_total), 2)                     as cobrado,
           round(sum(saldo), 2)                            as saldo,
           count(*) filter (where saldo > 0)::int          as con_saldo
      from public.v_ventas
     where project_id = p_project_id
       and compra_iniciada
  ) v
  cross join (
    -- Vencida = pendiente y con la fecha ya pasada. Una cuota anulada no se
    -- cobra, así que no está vencida.
    select count(*)::int                                            as cuotas_vencidas,
           round(sum(amount - coalesce(amount_paid, 0)), 2)          as monto_vencido
      from public.installments
     where project_id = p_project_id
       and status = 'pendiente'
       and due_date < current_date
  ) c;
$$;

grant execute on function public.rep_tablero_ventas(uuid) to authenticated;
