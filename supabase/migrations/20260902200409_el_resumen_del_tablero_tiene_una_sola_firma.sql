-- Al agregarle las fechas a rep_tablero_ventas quedó CONVIVIENDO con la firma
-- vieja de un solo argumento: `create or replace` con distinta aridad no
-- reemplaza, sobrecarga. Con las dos vivas, llamarla con un argumento da
-- «function is not unique» y la pantalla se cae.
--
-- Es la misma piedra de siempre —cambiar la aridad obliga a barrer— así que
-- acá se borra la vieja y se comprueba que quede exactamente una.

drop function if exists public.rep_tablero_ventas(uuid);

do $$
declare v_n int;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'rep_tablero_ventas';
  if v_n <> 1 then
    raise exception 'FIRMAS_DUPLICADAS: rep_tablero_ventas tiene % firmas, debe tener 1', v_n;
  end if;
end $$;
