-- Dos errores míos con el rol ventas, corregidos:
--
-- 1. La analítica propia existía, pero el MENÚ se la escondía a ventas: el
--    filtro por rol de la navegación nunca se actualizó. El vendedor tenía
--    su pantalla y ninguna puerta para llegar.
-- 2. Planes de pago les daba 'no' por defecto. Un vendedor necesita VER el
--    plan de su cliente —imprimirlo, mandarlo— aunque cobrar y editar siga
--    siendo de contabilidad. Queda en 've'.
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'nivel_de';

  if position('''contabilidad'',''fiscal'',''inventario'',''activos'',''rrhh'',''planes'',''comisiones'',''financiamiento''' in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA: la lista de secciones contables cambió';
  end if;

  -- planes sale de la lista de solo-contabilidad…
  v_def := replace(v_def,
    '''contabilidad'',''fiscal'',''inventario'',''activos'',''rrhh'',''planes'',''comisiones'',''financiamiento''',
    '''contabilidad'',''fiscal'',''inventario'',''activos'',''rrhh'',''comisiones'',''financiamiento''');

  -- …y gana su propia regla: contabilidad edita, ventas ve.
  if position('if p_seccion = ''analitica'' then' in v_def) = 0 then
    raise exception 'PARCHE_ANALITICA_NO_AGARRA';
  end if;
  v_def := replace(v_def,
    'if p_seccion = ''analitica'' then',
    'if p_seccion = ''planes'' then
    return case when v_role = ''contabilidad'' then ''edita'' else ''ve'' end;
  end if;
  if p_seccion = ''analitica'' then');

  execute v_def;
end $$;

-- Verificación en el acto, con el vendedor real.
select (private.nivel_de('83249056-8ce3-4c78-8d7c-3fc0f45fc5dd', 'planes'))    as planes_de_beymar,
       (private.nivel_de('83249056-8ce3-4c78-8d7c-3fc0f45fc5dd', 'analitica')) as analitica_de_beymar;
