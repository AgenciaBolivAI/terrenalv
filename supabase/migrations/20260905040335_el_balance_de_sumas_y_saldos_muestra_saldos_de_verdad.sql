-- Un «Balance de Sumas y Saldos» es, por definición, dos cosas a la vez:
--   SUMAS  → el movimiento DEL PERÍODO (debe y haber)
--   SALDOS → el saldo ACUMULADO al cierre de ese período
--
-- El reporte calculaba las dos mitades sobre el mismo rango, así que la columna
-- «saldo» era en realidad el movimiento del mes. Con el período que la pantalla
-- trae por defecto (el mes corriente), dos pestañas de la MISMA pantalla decían
-- cosas distintas de la misma cuenta:
--
--   1131 Cuentas por Cobrar   Sumas y saldos (01–30/09):  Bs  29.700,00
--                             Balance general (al 30/09): Bs 674.631,67
--
-- No es un desacuerdo de criterio: es que el saldo estaba mal. Sin rango de
-- fechas el mismo reporte ya devolvía 674.631,67 — o sea, la cuenta buena.
--
-- Ahora las sumas salen del rango y los saldos salen de TODO lo anterior hasta
-- `p_hasta`. Con eso el Balance de Sumas y Saldos vuelve a ser lo que un
-- contador espera: la hoja con la que se cuadra el Balance General, cuenta por
-- cuenta, sin tener que borrar el período para que coincidan.

create or replace function public.rep_sumas_y_saldos(
  p_project_id uuid,
  p_desde date default null,
  p_hasta date default null
)
returns table(
  cuenta text, cuenta_nombre text, tipo text, sort_order integer,
  debe numeric, haber numeric, saldo_deudor numeric, saldo_acreedor numeric
)
language sql
stable
set search_path to 'public', 'extensions'
as $function$
  with mov as (
    -- SUMAS: sólo lo que se movió dentro del período elegido.
    select d.cuenta,
           sum(d.debe)  as debe,
           sum(d.haber) as haber
      from public.v_libro_diario d
     where (p_project_id is null or d.project_id = p_project_id)
       and (p_desde is null or d.fecha >= p_desde)
       and (p_hasta is null or d.fecha <= p_hasta)
     group by d.cuenta
  ),
  acum as (
    -- SALDOS: todo lo anterior hasta el corte, sin piso. Es lo que tiene que
    -- coincidir con el Balance General a esa misma fecha.
    select d.cuenta,
           sum(d.debe) - sum(d.haber) as saldo
      from public.v_libro_diario d
     where (p_project_id is null or d.project_id = p_project_id)
       and (p_hasta is null or d.fecha <= p_hasta)
     group by d.cuenta
  )
  select c.code::text,
         c.name::text,
         c.kind::text,
         c.sort_order,
         coalesce(m.debe, 0)  as debe,
         coalesce(m.haber, 0) as haber,
         greatest(coalesce(a.saldo, 0), 0)  as saldo_deudor,
         greatest(-coalesce(a.saldo, 0), 0) as saldo_acreedor
    from public.chart_of_accounts c
    left join mov  m on m.cuenta = c.code
    left join acum a on a.cuenta = c.code
   -- Una cuenta sin movimiento del período pero CON saldo anterior tiene que
   -- aparecer: si no, la hoja no suma lo mismo que el balance.
   where m.cuenta is not null or coalesce(a.saldo, 0) <> 0
   order by c.sort_order;
$function$;

-- Guardián: el saldo de cada cuenta en Sumas y Saldos es el mismo que en el
-- Balance General a la misma fecha. Es el invariante que faltaba — el que
-- habría cantado los Bs 29.700 contra Bs 674.631,67.
create or replace function private.sumas_que_no_cuadran_con_el_balance()
returns table(cuenta text, en_sumas numeric, en_balance numeric)
language sql
stable
set search_path to 'public', 'private'
as $$
  with s as (
    select cuenta, saldo_deudor - saldo_acreedor as saldo
      from public.rep_sumas_y_saldos(null, '2000-01-01'::date, current_date)
  ),
  b as (
    select cuenta,
           case when seccion = 'Activo' then monto else -monto end as saldo
      from public.rep_balance_general(null, current_date)
     where cuenta <> '3999'
  )
  select coalesce(s.cuenta, b.cuenta), s.saldo, b.saldo
    from s full join b on b.cuenta = s.cuenta
   where round(coalesce(s.saldo, 0), 2) is distinct from round(coalesce(b.saldo, 0), 2)
     and coalesce(s.cuenta, b.cuenta) in (
       select code from public.chart_of_accounts
        where kind in ('activo','pasivo','patrimonio'));
$$;

do $$
declare
  v_def text;
  v_ancla text := $ancla$  select count(*) into v_n from private.cuentas_del_libro_que_no_existen();
  return query select 'toda_cuenta_del_libro_existe_y_esta_activa'::text, (v_n = 0),
    format('%s cuenta(s) usadas por el libro que no existen o están inactivas', v_n);$ancla$;
begin
  v_def := pg_get_functiondef('public.verificar_integridad()'::regprocedure);
  if position(v_ancla in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA: falta el ancla de cuentas del libro';
  end if;
  execute replace(v_def, v_ancla, v_ancla || $nuevo$

  -- Sumas y Saldos y el Balance General dicen el mismo saldo por cuenta.
  select count(*) into v_n from private.sumas_que_no_cuadran_con_el_balance();
  return query select 'sumas_y_saldos_cuadra_con_el_balance'::text, (v_n = 0),
    format('%s cuenta(s) con saldo distinto entre Sumas y Saldos y el Balance General', v_n);$nuevo$);
end $$;
