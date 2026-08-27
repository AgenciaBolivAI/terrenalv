-- El guardián de la regla: NADA del gerencial puede nombrar al fiscal.
--
-- Una regla de arquitectura que no se verifica dura hasta el primer apuro.
-- Esta corre antes de cada despliegue y frena el build.
--
-- No trabaja por prefijo, porque public.fiscal_periods (las gestiones
-- contables) es del GERENCIAL y se llama igual de entrada. Trabaja con la
-- lista explícita de los objetos de este módulo.

create or replace function private.fiscal_fugas()
returns table(objeto text, detalle text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tablas text[] := array['fiscal_comprobantes','fiscal_lineas','fiscal_exclusiones'];
  v_objetos text[] := array['fiscal_comprobantes','fiscal_lineas','fiscal_exclusiones',
                            'v_fiscal_libro_diario','v_fiscal_sumas_y_saldos','v_fiscal_pendiente'];
  -- Los del propio módulo fiscal, más el guardián y su llamador: nombrar lo
  -- que uno vigila no es una fuga.
  v_exentos text[] := array['fiscal_comprobantes','fiscal_lineas','fiscal_exclusiones',
                            'v_fiscal_libro_diario','v_fiscal_sumas_y_saldos','v_fiscal_pendiente',
                            'fiscal_importar_uno','fiscal_importar','fiscal_excluir','fiscal_incluir',
                            'fiscal_guardar_comprobante','fiscal_anular_comprobante',
                            'next_fiscal_number','fiscal_fugas','verificar_integridad'];
  v_patron text;
begin
  v_patron := '\m(' || array_to_string(v_objetos, '|') || ')\M';

  -- A) Ninguna llave foránea del gerencial apunta al fiscal. Las del fiscal
  --    hacia el gerencial sí están permitidas: esa es la dirección buena.
  return query
    select t.relname::text,
           'llave foránea ' || c.conname || ' apunta a ' || f.relname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_class f on f.oid = c.confrelid
     where c.contype = 'f'
       and f.relname = any(v_tablas)
       and not (t.relname = any(v_tablas));

  -- B) Ninguna vista del gerencial nombra al fiscal.
  return query
    select v.viewname::text, 'la vista nombra objetos del módulo fiscal'
      from pg_views v
     where v.schemaname = 'public'
       and not (v.viewname = any(v_exentos))
       and v.definition ~ v_patron;

  -- C) Ninguna función del gerencial nombra al fiscal.
  return query
    select (n.nspname || '.' || p.proname)::text,
           'la función nombra objetos del módulo fiscal'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public','private')
       and not (p.proname = any(v_exentos))
       and p.prosrc ~ v_patron;
end;
$$;

revoke all on function private.fiscal_fugas() from public, anon, authenticated;

-- ---------- los dos chequeos nuevos, dentro del guardián de siempre --------
do $$
declare
  v_def text;
  v_ancla text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'verificar_integridad';

  v_ancla :=
'  return query select ''comisiones_del_mercado_consistentes''::text, (v_n = 0),
    format(''%s comisión(es) inconsistente(s)'', v_n);
end;';

  if position(v_ancla in v_def) = 0 then
    raise exception 'PARCHE_INTEGRIDAD_NO_AGARRA';
  end if;

  v_def := replace(v_def, v_ancla,
'  return query select ''comisiones_del_mercado_consistentes''::text, (v_n = 0),
    format(''%s comisión(es) inconsistente(s)'', v_n);

  -- La contabilidad fiscal mira al gerencial; el gerencial no sabe que
  -- existe. Si alguna vez alguien la enchufa al revés, se entera acá.
  select count(*) into v_n from private.fiscal_fugas();
  return query select ''el_gerencial_no_sabe_del_fiscal''::text, (v_n = 0),
    coalesce((select string_agg(objeto || '': '' || detalle, ''; '')
                from private.fiscal_fugas()),
             ''el gerencial no nombra nada del fiscal'');

  -- Y el libro fiscal cuadra por su cuenta, como cualquier libro.
  select count(*) into v_n from (
    select project_id from public.v_fiscal_libro_diario
     group by project_id having round(sum(debe),2) <> round(sum(haber),2)) t;
  return query select ''libro_fiscal_cuadra''::text, (v_n = 0),
    format(''%s urbanización(es) descuadrada(s) en el libro fiscal'', v_n);
end;');

  execute v_def;
end $$;

-- ---------- la sección «fiscal» en los permisos ----------------------------
do $$
declare v_def text;
begin
  -- nivel_de: fiscal se comporta como el resto de lo contable (contabilidad
  -- edita, ventas no ve), y desde ahí el dueño recorta persona por persona.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'nivel_de';
  if position('''contabilidad'',''planes'',''comisiones'',''financiamiento''' in v_def) = 0 then
    raise exception 'PARCHE_NIVEL_DE_NO_AGARRA';
  end if;
  v_def := replace(v_def,
    '''contabilidad'',''planes'',''comisiones'',''financiamiento''',
    '''contabilidad'',''fiscal'',''planes'',''comisiones'',''financiamiento''');
  execute v_def;

  -- mi_acceso: que la sección nueva viaje al panel.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mi_acceso';
  if position('''contabilidad'',''planes''' in v_def) = 0 then
    raise exception 'PARCHE_MI_ACCESO_NO_AGARRA';
  end if;
  v_def := replace(v_def, '''contabilidad'',''planes''', '''contabilidad'',''fiscal'',''planes''');
  execute v_def;

  -- admin_guardar_permisos: y que se pueda guardar.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_guardar_permisos';
  if position('''contabilidad'',''planes''' in v_def) = 0 then
    raise exception 'PARCHE_GUARDAR_PERMISOS_NO_AGARRA';
  end if;
  v_def := replace(v_def, '''contabilidad'',''planes''', '''contabilidad'',''fiscal'',''planes''');
  execute v_def;
end $$;
