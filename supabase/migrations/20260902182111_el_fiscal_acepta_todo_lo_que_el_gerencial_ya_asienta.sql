-- El libro gerencial creció tres orígenes nuevos —terreno, activo y fondo—
-- y el lado fiscal se quedó en la lista vieja. Las filas aparecían en la cola
-- de pendientes, pero «Declarar» tiraba ORIGEN_INVALIDO, y peor: la
-- importación por período recorría la cola sin filtrar, chocaba con el primer
-- activo y REVERTÍA la importación entera. La contadora pidió justamente que
-- «todo esto que está en la contabilidad gerencial debería estar en la
-- contabilidad fiscal».
--
-- Además: pidió el balance de sumas y saldos del libro FISCAL. La vista
-- v_fiscal_sumas_y_saldos existía sin rango de fechas ni forma de reporte;
-- acá nace rep_fiscal_sumas_y_saldos, calcado de rep_sumas_y_saldos (misma
-- forma, mismas columnas) pero leyendo el libro fiscal. Dirección permitida:
-- el fiscal lee del gerencial, nunca al revés — esto ni toca el gerencial.

-- 1) El check de la tabla acepta los tres orígenes nuevos.
alter table public.fiscal_comprobantes drop constraint fiscal_comprobantes_origen_check;
alter table public.fiscal_comprobantes add constraint fiscal_comprobantes_origen_check
  check ((origen is null and origen_id is null)
      or (origen in ('venta','pago','egreso','comprobante','terreno','activo','fondo')
          and origen_id is not null));

-- 2) La lista blanca del importador, con el idioma de la casa.
do $$
declare
  v text;
  v_viejo text := $v$p_origen not in ('venta','pago','egreso','comprobante')$v$;
  v_nuevo text := $v$p_origen not in ('venta','pago','egreso','comprobante','terreno','activo','fondo')$v$;
begin
  v := pg_get_functiondef('public.fiscal_importar_uno(text,uuid,text)'::regprocedure);
  if position(v_viejo in v) = 0 then
    raise exception 'PARCHE_NO_AGARRA: fiscal_importar_uno ya no tiene la lista vieja';
  end if;
  execute replace(v, v_viejo, v_nuevo);
end $$;

-- 3) El balance de sumas y saldos del libro fiscal, con la misma forma que el
--    gerencial para que la pantalla y el export sean gemelos.
create or replace function public.rep_fiscal_sumas_y_saldos(
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
as $$
  select
    d.cuenta,
    c.name,
    c.kind,
    c.sort_order,
    sum(d.debe)  as debe,
    sum(d.haber) as haber,
    greatest(sum(d.debe) - sum(d.haber), 0) as saldo_deudor,
    greatest(sum(d.haber) - sum(d.debe), 0) as saldo_acreedor
  from public.v_fiscal_libro_diario d
  join public.chart_of_accounts c on c.code = d.cuenta
  where (p_project_id is null or d.project_id = p_project_id)
    and (p_desde is null or d.fecha >= p_desde)
    and (p_hasta is null or d.fecha <= p_hasta)
  group by d.cuenta, c.name, c.kind, c.sort_order
  order by c.sort_order;
$$;

grant execute on function public.rep_fiscal_sumas_y_saldos(uuid, date, date) to authenticated;

-- 4) El guardián de fugas tiene que conocer al recién llegado: nombra objetos
--    fiscales desde una función pública, y sin la exención se pondría rojo.
do $$
declare
  v text;
  v_ancla text := $a$'next_fiscal_number','fiscal_fugas','verificar_integridad']$a$;
  v_nuevo text := $a$'next_fiscal_number','fiscal_fugas','verificar_integridad','rep_fiscal_sumas_y_saldos']$a$;
begin
  v := pg_get_functiondef('private.fiscal_fugas()'::regprocedure);
  if position(v_ancla in v) = 0 then
    raise exception 'PARCHE_NO_AGARRA: la lista de exentos de fiscal_fugas cambió de forma';
  end if;
  execute replace(v, v_ancla, v_nuevo);
end $$;
