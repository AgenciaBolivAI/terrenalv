-- Esta mañana se cerró la LECTURA del libro fiscal (la RLS pasó al techo del
-- rol). La ESCRITURA quedó abierta: los ocho RPC que tocan el libro fiscal
-- seguían usando `private.assert_accounting()`, la puerta floja del mostrador,
-- que honra el permiso escrito a mano.
--
-- Probado con cada perfil vivo:
--
--   Beymar (ventas)          assert_accounting → PASA      assert_seccion(fiscal) → bloqueado
--   Giovana (contabilidad)   assert_accounting → PASA      assert_seccion(fiscal) → PASA
--   Auditor 2 (contabilidad) assert_accounting → PASA      assert_seccion(fiscal) → PASA
--   los dos admin            assert_accounting → PASA      assert_seccion(fiscal) → PASA
--
-- O sea: un vendedor podía registrar facturas, importar al libro fiscal, anular
-- comprobantes y excluir movimientos de la declaración — mientras la pantalla
-- de Fiscal ni siquiera se le abre. Cambiar la puerta no le saca nada a nadie
-- que hoy lo use: los cuatro que trabajan el libro pasan por las dos.
--
-- NO se toca is_accounting(): sigue siendo la puerta del mostrador y de los ~49
-- RPC de la trastienda, incluido cobrar. Lo que cambia es qué exige el FISCAL.

do $$
declare
  r record;
  v_def text;
  v_n int := 0;
begin
  for r in
    select p.oid::regprocedure as firma
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and p.proname in ('fiscal_registrar_factura','fiscal_anular_factura',
                         'fiscal_guardar_comprobante','fiscal_anular_comprobante',
                         'fiscal_importar','fiscal_importar_uno',
                         'fiscal_excluir','fiscal_incluir')
  loop
    v_def := pg_get_functiondef(r.firma);
    if position('private.assert_accounting()' in v_def) = 0 then
      raise exception 'PARCHE_NO_AGARRA: % ya no usa assert_accounting', r.firma;
    end if;
    execute replace(v_def, 'private.assert_accounting()', $q$private.assert_seccion('fiscal')$q$);
    v_n := v_n + 1;
  end loop;
  if v_n <> 8 then
    raise exception 'PARCHE_NO_AGARRA: se esperaban 8 RPC fiscales, se parchearon %', v_n;
  end if;
end $$;

-- Guardián: ninguna función del libro fiscal puede volver a colgarse de la
-- puerta floja. Mide por OID, no por texto — la lección de esta mañana.
create or replace function private.fiscal_con_puerta_floja()
returns table(funcion text)
language sql
stable
set search_path to 'public', 'private', 'pg_catalog'
as $$
  select p.proname::text
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and p.proname like 'fiscal!_%' escape '!'
     and exists (
       select 1 from pg_catalog.pg_depend d
        join pg_catalog.pg_proc g on g.oid = d.refobjid
        join pg_catalog.pg_namespace gn on gn.oid = g.pronamespace
       where d.classid = 'pg_proc'::regclass and d.objid = p.oid
         and d.refclassid = 'pg_proc'::regclass
         and gn.nspname = 'private' and g.proname in ('assert_accounting', 'is_accounting'));
$$;

do $$
declare
  v_def text;
  v_ancla text := $ancla$  select count(*) into v_n from private.planes_vivos_de_ventas_muertas();
  return query select 'ninguna_venta_muerta_deja_plan_vivo'::text, (v_n = 0),
    format('%s plan(es) activos o con cuotas vivas sobre ventas no confirmadas', v_n);$ancla$;
begin
  v_def := pg_get_functiondef('public.verificar_integridad()'::regprocedure);
  if position(v_ancla in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA: falta el ancla de planes vivos';
  end if;
  execute replace(v_def, v_ancla, v_ancla || $nuevo$

  -- El libro fiscal se escribe por la puerta de su sección, no por la del
  -- mostrador.
  select count(*) into v_n from private.fiscal_con_puerta_floja();
  return query select 'el_fiscal_no_usa_la_puerta_floja'::text, (v_n = 0),
    format('%s RPC fiscal(es) colgados de is_accounting', v_n);$nuevo$);
end $$;
