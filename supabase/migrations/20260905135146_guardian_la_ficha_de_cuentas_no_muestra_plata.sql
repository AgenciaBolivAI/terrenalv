-- Cuentas promete mostrar a la persona y NADA de plata. Esa promesa se cumple
-- no seleccionando importes, no escondiéndolos en la pantalla. Pero mañana
-- alguien agrega una columna «saldo» a una de las dos vistas «para tenerla a
-- mano» y la promesa se rompe sin que nadie lo note. Este guardián mira las
-- columnas de las dos vistas y se pone rojo si aparece una de plata.
create or replace function private.columnas_de_plata_en_la_ficha()
returns table(vista text, columna text)
language sql stable
set search_path to 'public', 'private', 'pg_temp'
as $function$
  select c.table_name::text, c.column_name::text
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name in ('v_clientes_ficha', 'v_cliente_actividad_ficha')
     and (c.column_name ~* 'pagad|saldo|monto|precio|invert|_bob|comision|price|amount|interes|deuda|abonad|cobrad'
          or c.data_type = 'money');
$function$;

do $$
declare
  v_def text;
  v_new text;
  v_anchor text := $a$  -- Sumas y Saldos y el Balance General dicen el mismo saldo por cuenta.$a$;
  v_extra text := $x$  -- La pantalla de Cuentas no puede empezar a mostrar plata.
  select count(*) into v_n from private.columnas_de_plata_en_la_ficha();
  return query select 'la_ficha_de_cuentas_no_muestra_plata'::text, (v_n = 0),
    format('%s columna(s) de plata en las vistas que Cuentas lee', v_n);

$x$;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'verificar_integridad';

  if position(v_anchor in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA: no se encontró el ancla en verificar_integridad';
  end if;
  if position('la_ficha_de_cuentas_no_muestra_plata' in v_def) > 0 then
    raise exception 'PARCHE_NO_AGARRA: el guardián ya estaba';
  end if;

  v_new := replace(v_def, v_anchor, v_extra || v_anchor);
  execute v_new;
end $$;
