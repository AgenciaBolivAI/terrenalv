-- El guardián de fugas acusaba a v_fiscal_libro_iva y v_fiscal_posicion_iva
-- de nombrar objetos fiscales. Claro que los nombran: SON del módulo fiscal.
-- Mi parche las metió en la lista vigilada pero no en la de exentos.
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'fiscal_fugas';

  if position('''fiscal_registrar_factura'',''fiscal_anular_factura'',' in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA';
  end if;
  v_def := replace(v_def,
    '''fiscal_registrar_factura'',''fiscal_anular_factura'',',
    '''fiscal_registrar_factura'',''fiscal_anular_factura'',
                            ''fiscal_facturas'',''fiscal_parametros'',
                            ''v_fiscal_libro_iva'',''v_fiscal_posicion_iva'',');
  execute v_def;
end $$;

select count(*) as fugas from private.fiscal_fugas();
select count(*) as fallas from public.verificar_integridad() where not ok;
