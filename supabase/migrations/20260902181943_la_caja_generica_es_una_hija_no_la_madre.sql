-- La contadora cargó su primer banco y el guardián se puso rojo:
-- «no_se_asienta_en_cuentas_titulares :: 52 movimientos en una cuenta que
-- tiene hijas». Tenía razón el guardián: cada banco nuevo nace como hija de
-- 1111 (1111.01, 1111.02…), así que en el momento en que existe UNA cuenta de
-- tesorería, 1111 pasa a ser cuenta madre — y todo lo que el libro derivaba
-- al comodín '1111' quedó asentado en una cuenta que agrupa.
--
-- La cura sigue la doctrina, no la esquiva: el comodín deja de ser la madre y
-- pasa a ser una hija más, «1111.00 · Caja y Bancos sin especificar». Los
-- movimientos viejos se mudan solos porque el libro es DERIVADO: se toca
-- private.libro_base y las 52 filas caen en la hoja nueva sin tocar un dato.
-- 1111 queda como lo que es: un título que suma a sus hijas.
--
-- De paso se cierra una fuga que encontró el relevamiento: v_monthly_cashflow
-- se reescribió sobre libro_base (la base SIN puerta) y quedó legible para
-- cualquier miembro del equipo; ahora lleva el mismo ve_contabilidad() que
-- las demás vistas del libro.

-- 1) La hoja nueva, hermana menor de todas las cuentas de tesorería.
insert into public.chart_of_accounts (code, name, kind, sort_order, parent_code, is_system)
values ('1111.00', 'Caja y Bancos sin especificar', 'activo', 10101010, '1111', true)
on conflict (code) do nothing;

-- 2) El libro: los siete comodines '1111' pasan a '1111.00'.
do $$
declare
  v text;
  v_n int;
begin
  v := pg_get_viewdef('private.libro_base'::regclass);
  v_n := (length(v) - length(replace(v, '''1111''::text', ''))) / length('''1111''::text');
  if v_n <> 7 then
    raise exception 'PARCHE_NO_AGARRA: libro_base tiene % comodines 1111, se esperaban 7', v_n;
  end if;
  execute 'create or replace view private.libro_base as '
          || replace(v, '''1111''::text', '''1111.00''::text');
end $$;

-- 3) La anulación con devolución usaba el mismo comodín.
do $$
declare
  v text;
  v_n int;
begin
  v := pg_get_functiondef('public.admin_anular_pago(uuid,text,text,numeric,uuid)'::regprocedure);
  v_n := (length(v) - length(replace(v, '''1111''', ''))) / length('''1111''');
  if v_n <> 1 then
    raise exception 'PARCHE_NO_AGARRA: admin_anular_pago tiene % comodines, se esperaba 1', v_n;
  end if;
  execute replace(v, '''1111''', '''1111.00''');
end $$;

-- 4) El flujo mensual: suma la hoja nueva (y la vieja por si acaso), y de paso
--    recibe la puerta que le faltaba.
create or replace view public.v_monthly_cashflow as
select d.project_id,
       date_trunc('month', d.fecha::timestamptz)::date as mes,
       sum(d.debe)  as ingresos_bob,
       sum(d.haber) as egresos_bob,
       sum(d.debe) - sum(d.haber) as resultado_bob
  from private.libro_base d
 where (d.cuenta in ('1111', '1111.00')
        or d.cuenta in (select account_code from public.treasury_accounts))
   and private.ve_contabilidad()
 group by d.project_id, date_trunc('month', d.fecha::timestamptz)::date;
