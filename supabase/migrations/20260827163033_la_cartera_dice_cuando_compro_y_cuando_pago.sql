-- La cartera necesita las dos fechas que se miran al cobrar: cuándo COMPRÓ
-- (fecha_venta, que ya estaba) y cuándo PAGÓ por última vez. Al final de la
-- lista, que es donde se agrega una columna sin renombrar a las vecinas.
do $$
declare v_def text; v_ancla text;
begin
  select pg_get_viewdef('public.v_cartera'::regclass, true) into v_def;
  v_ancla := 'v.titular_nombre';
  if position(v_ancla in v_def) = 0 then
    raise exception 'ANCLA_NO_ENCONTRADA';
  end if;
  v_def := replace(v_def, v_ancla, v_ancla || ',
    v.ultimo_pago AS fecha_ultimo_pago');
  execute 'create or replace view public.v_cartera as ' || v_def;
  execute 'alter view public.v_cartera set (security_invoker = true)';
end $$;

select count(*) as filas,
       count(fecha_venta)       as con_fecha_compra,
       count(fecha_ultimo_pago) as con_fecha_pago
  from public.v_cartera;
