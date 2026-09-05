-- Tercera vez que aparece el MISMO desajuste: el libro gerencial gana un
-- origen y el lado fiscal se entera tarde. Hoy `private.libro_base` emite
--   activo, comprobante, egreso, pago, pago_proveedor, venta
-- y `pago_proveedor` está en la cola de v_fiscal_pendiente pero lo rechazan
-- tanto el CHECK de fiscal_comprobantes como la lista blanca de
-- fiscal_importar_uno. Consecuencia: una importación por período que abarque
-- un pago a proveedor revienta con ORIGEN_INVALIDO y REVIERTE ENTERA.
--
-- Se arregla el origen y —para no volver a arreglarlo una cuarta vez— se ata
-- con un guardián: todo origen que el libro emite tiene que ser aceptado por
-- los dos lados del fiscal.

alter table public.fiscal_comprobantes drop constraint fiscal_comprobantes_origen_check;
alter table public.fiscal_comprobantes add constraint fiscal_comprobantes_origen_check
  check ((origen is null and origen_id is null)
      or (origen in ('venta','pago','egreso','comprobante','terreno','activo','fondo','pago_proveedor')
          and origen_id is not null));

do $$
declare
  v text;
  v_viejo text := $v$p_origen not in ('venta','pago','egreso','comprobante','terreno','activo','fondo')$v$;
  v_nuevo text := $v$p_origen not in ('venta','pago','egreso','comprobante','terreno','activo','fondo','pago_proveedor')$v$;
begin
  v := pg_get_functiondef('public.fiscal_importar_uno(text,uuid,text)'::regprocedure);
  if position(v_viejo in v) = 0 then
    raise exception 'PARCHE_NO_AGARRA: la lista blanca de fiscal_importar_uno cambió de forma';
  end if;
  execute replace(v, v_viejo, v_nuevo);
end $$;

-- El guardián: compara los orígenes VIVOS del libro contra lo que el CHECK
-- acepta. Lee el catálogo, no un literal, así que no se puede desincronizar.
create or replace function private.origenes_que_el_fiscal_rechaza()
returns table(origen text)
language sql
stable
set search_path to 'public', 'private', 'pg_catalog'
as $$
  select distinct b.origen::text
    from private.libro_base b
   where b.origen is not null
     and not exists (
       select 1 from pg_catalog.pg_constraint c
        where c.conname = 'fiscal_comprobantes_origen_check'
          and pg_catalog.pg_get_constraintdef(c.oid) like '%''' || b.origen || '''%');
$$;

do $$
declare
  v_def text;
  v_ancla text := $ancla$  select count(*) into v_n from private.prioridades_invalidas();
  return query select 'los_avisos_usan_prioridades_validas'::text, (v_n = 0),
    format('%s aviso(s) con prioridad fuera de alta/normal/baja', v_n);$ancla$;
begin
  v_def := pg_get_functiondef('public.verificar_integridad()'::regprocedure);
  if position(v_ancla in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA: falta el ancla de prioridades';
  end if;
  execute replace(v_def, v_ancla, v_ancla || $nuevo$

  -- Todo origen que el libro gerencial emite tiene que poder declararse: si no,
  -- la importación por período revienta entera al toparse con el primero.
  select count(*) into v_n from private.origenes_que_el_fiscal_rechaza();
  return query select 'el_fiscal_acepta_todo_origen_del_libro'::text, (v_n = 0),
    format('%s origen(es) del libro que el fiscal rechaza', v_n);$nuevo$);
end $$;
