-- v_libro_diario corre como QUIEN PREGUNTA (security_invoker). Yo le revoqué
-- a authenticated el permiso sobre private.costo_m2 «por prolijidad», y con
-- eso el libro entero explotaba para todo el equipo: permission denied.
--
-- Sólo apareció al probar como usuario autenticado — como postgres andaba
-- perfecto. Las demás funciones private que usa el libro (forma_de_pago,
-- origen_de_venta, etiqueta_origen) siempre estuvieron accesibles; ésta era
-- la excepción, y por error mío.
--
-- Es SECURITY DEFINER y de sólo lectura: devuelve el costo por m² del
-- proyecto, que cualquiera del equipo ve igual en la pantalla de inventario.
grant execute on function private.costo_m2(uuid, date) to authenticated;

-- Y que no vuelva a pasar: un chequeo que verifica que el equipo puede
-- ejecutar TODO lo que el libro necesita para armarse.
do $$
declare v_def text; v_ancla text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'verificar_integridad';

  v_ancla :=
'  return query select ''escala_de_comision_completa''::text, (v_n = 0),
    format(''%s escala(s) que no arrancan en 1 o no tienen tramo abierto al final'', v_n);
end;';
  if position(v_ancla in v_def) = 0 then
    raise exception 'PARCHE_LIBRO_NO_AGARRA';
  end if;

  v_def := replace(v_def, v_ancla,
'  return query select ''escala_de_comision_completa''::text, (v_n = 0),
    format(''%s escala(s) que no arrancan en 1 o no tienen tramo abierto al final'', v_n);

  -- El libro corre como quien pregunta: si el equipo no puede ejecutar
  -- alguna de las funciones que lo arman, la contabilidad entera deja de
  -- abrir. Ya pasó una vez con private.costo_m2.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = ''private''
     and p.proname = any (array[''forma_de_pago'',''origen_de_venta'',''etiqueta_origen'',
                                ''costo_m2'',''meses_completos'',''normalize_ci''])
     and not has_function_privilege(''authenticated'', p.oid, ''execute'');
  return query select ''el_equipo_puede_abrir_el_libro''::text, (v_n = 0),
    format(''%s función(es) del libro que el equipo no puede ejecutar'', v_n);
end;');

  execute v_def;
end $$;
