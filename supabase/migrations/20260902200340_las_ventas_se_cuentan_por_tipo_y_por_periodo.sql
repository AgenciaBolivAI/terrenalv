-- La contadora necesita las ventas POR TIPO y por período elegido a mano
-- («cuántas ventas al contado tuve en el día»). Las definiciones son de ella:
--
--   Contado  — pagada por completo, sin cuotas.
--   Crédito  — el cliente paga en cuotas mensuales.
--   Traspaso — el comprador le cede su terreno a otra persona.
--
-- Y aparece un CUARTO grupo que sus tres no cubren: ventas sin cronograma de
-- cuotas que todavía deben plata. No son contado (no están pagadas) ni crédito
-- (no tienen cuotas). Se muestran aparte en vez de esconderlas o de meterlas a
-- la fuerza en un grupo que no les corresponde: son 5 ventas por Bs 220.000, y
-- callarlas haría que los tipos no sumen el total.
--
-- El orden del CASE importa y define la prioridad: un traspaso pagado del todo
-- es traspaso, no contado. Así cada venta cae en UN grupo y los grupos suman
-- exactamente el total — la regla que ya nos mordió cuando el embudo decía 8 y
-- la casilla 7.
--
-- p_project_id null = toda la empresa. Fechas null = sin recorte.

create or replace function public.rep_ventas_por_tipo(
  p_project_id uuid default null,
  p_desde date default null,
  p_hasta date default null
)
returns table(
  tipo text,
  orden integer,
  ventas integer,
  valor numeric,
  cobrado numeric,
  saldo numeric
)
language sql
stable
set search_path to 'public', 'extensions'
as $$
  with t as (
    select case
             when traspaso then 'Traspaso'
             when con_plan then 'Crédito'
             when saldo <= 0 then 'Contado'
             else 'Sin plan'
           end as tipo,
           case
             when traspaso then 3
             when con_plan then 2
             when saldo <= 0 then 1
             else 4
           end as orden,
           price_agreed, pagado_total, saldo
      from public.v_ventas
     where compra_iniciada
       and (p_project_id is null or project_id = p_project_id)
       and (p_desde is null or fecha_venta >= p_desde)
       and (p_hasta is null or fecha_venta <= p_hasta)
  )
  select tipo,
         orden,
         count(*)::int,
         round(sum(price_agreed), 2),
         round(sum(pagado_total), 2),
         round(sum(saldo), 2)
    from t
   group by tipo, orden
   order by orden;
$$;

grant execute on function public.rep_ventas_por_tipo(uuid, date, date) to authenticated;

-- El resumen del tablero acepta el mismo recorte de fechas, para que la tira de
-- arriba y el desglose de abajo hablen del mismo período.
create or replace function public.rep_tablero_ventas(
  p_project_id uuid,
  p_desde date default null,
  p_hasta date default null
)
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
     where compra_iniciada
       and (p_project_id is null or project_id = p_project_id)
       and (p_desde is null or fecha_venta >= p_desde)
       and (p_hasta is null or fecha_venta <= p_hasta)
  ) v
  cross join (
    -- Las cuotas vencidas son de HOY, no del período: es una cola de trabajo
    -- («a quién hay que llamar»), no una cifra histórica.
    select count(*)::int                                            as cuotas_vencidas,
           round(sum(amount - coalesce(amount_paid, 0)), 2)          as monto_vencido
      from public.installments
     where (p_project_id is null or project_id = p_project_id)
       and status = 'pendiente'
       and due_date < current_date
  ) c;
$$;

grant execute on function public.rep_tablero_ventas(uuid, date, date) to authenticated;
