-- La contadora pidió «un informe de flujo de efectivo que es neto movimiento
-- ingresos gastos, en base a los movimientos bancarios, para pasar informes a
-- gerencia con gráficos». La serie mensual ya existe (v_monthly_cashflow);
-- lo que faltaba es el DESGLOSE: de dónde entró la plata y a dónde se fue.
--
-- Mecánica: por cada comprobante que movió plata por caja o banco, el
-- movimiento de caja se clasifica por sus CONTRACUENTAS (los cobros contra
-- 1131 son «Cuentas por Cobrar Clientes», un egreso contra un gasto lleva el
-- nombre del gasto). Si el comprobante tiene varias contracuentas, el monto se
-- reparte a prorrata — así el total del desglose cierra EXACTO contra la
-- serie mensual. Las transferencias entre cuentas propias no son ni entrada
-- ni salida: van en su propia sección, para que nadie las lea como ingreso.
--
-- Lee v_libro_diario (con puerta), estilo rep_* de la casa.

create or replace function public.rep_flujo_efectivo(
  p_project_id uuid,
  p_desde date default null,
  p_hasta date default null
)
returns table(
  seccion text, categoria text, cuenta text, monto numeric, movimientos integer
)
language sql
stable
set search_path to 'public', 'private', 'extensions'
as $$
  with tes as (
    select '1111'::text as code
    union all select '1111.00'
    union all select account_code from public.treasury_accounts
  ),
  rango as (
    select d.*
      from public.v_libro_diario d
     where (p_project_id is null or d.project_id = p_project_id)
       and (p_desde is null or d.fecha >= p_desde)
       and (p_hasta is null or d.fecha <= p_hasta)
  ),
  mov as (
    -- Por comprobante: cuánta plata entró o salió por caja-banco, y si tiene
    -- contracuentas (una transferencia interna no las tiene).
    select r.comprobante,
           sum(case when r.cuenta in (select code from tes) then r.debe - r.haber else 0 end) as caja_neto,
           sum(case when r.cuenta in (select code from tes) then r.debe else 0 end)           as caja_debe,
           count(*) filter (where r.cuenta not in (select code from tes))                      as contrapartidas
      from rango r
     group by r.comprobante
    having sum(case when r.cuenta in (select code from tes) then abs(r.debe) + abs(r.haber) else 0 end) > 0
  ),
  reparto as (
    -- El movimiento de caja repartido a prorrata entre las contracuentas.
    select m.comprobante,
           m.caja_neto,
           r.cuenta,
           (r.debe + r.haber) / nullif(sum(r.debe + r.haber) over (partition by r.comprobante), 0) as proporcion
      from mov m
      join rango r on r.comprobante = m.comprobante
     where m.contrapartidas > 0
       and round(m.caja_neto, 2) <> 0
       and r.cuenta not in (select code from tes)
  )
  select case when x.caja_neto > 0 then 'Entradas' else 'Salidas' end as seccion,
         c.name as categoria,
         coalesce(c.codigo_plan, x.cuenta) as cuenta,
         round(sum(abs(x.caja_neto) * coalesce(x.proporcion, 0)), 2) as monto,
         count(distinct x.comprobante)::int as movimientos
    from reparto x
    join public.chart_of_accounts c on c.code = x.cuenta
   group by 1, c.name, coalesce(c.codigo_plan, x.cuenta)

  union all

  -- Plata que cambió de bolsillo sin salir de la empresa.
  select 'Transferencias internas',
         'Movimientos entre cuentas propias',
         null,
         round(sum(m.caja_debe), 2),
         count(*)::int
    from mov m
   where m.contrapartidas = 0
  having count(*) > 0

   order by 1, 4 desc;
$$;

grant execute on function public.rep_flujo_efectivo(uuid, date, date) to authenticated;
