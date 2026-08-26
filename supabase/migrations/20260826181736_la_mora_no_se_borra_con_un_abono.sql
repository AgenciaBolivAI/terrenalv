-- 2. Tras un abono a capital, el conteo de cuotas y la fecha de arranque
--    ignoraban las cuotas VENCIDAS: un plan con mora quedaba con menos cuotas
--    y el cronograma nuevo saltaba las fechas atrasadas — la mora se borraba
--    en silencio. Cuentan todas las pendientes y se arranca en la fecha más
--    vieja, así lo vencido sigue vencido y a la vista.
--
-- Se parcha la función en el lugar, sin retranscribirla: el texto viejo se
-- reemplaza quirúrgicamente y se valida que el parche agarró exactamente
-- las DOS apariciones (el conteo y el min de fecha).
do $$
declare
  v_def text;
  v_hits int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_register_cuota_payment'
     and pg_get_function_identity_arguments(p.oid) like '%p_recalculo%';

  v_hits := (length(v_def) - length(replace(v_def,
    'status in (''pendiente'',''parcial'') and due_date >= current_date', '')))
    / length('status in (''pendiente'',''parcial'') and due_date >= current_date');
  if v_hits <> 2 then
    raise exception 'PARCHE_NO_AGARRA: % apariciones, esperaba 2', v_hits;
  end if;

  v_def := replace(v_def,
    'status in (''pendiente'',''parcial'') and due_date >= current_date',
    'status in (''pendiente'',''parcial'')');

  execute v_def;
end $$;
