-- Completar la cuota inicial convierte la reserva en venta, sola.
--
-- Es el momento en que el negocio cambia de naturaleza: dejó de ser un lote
-- guardado y pasó a ser una compra en marcha. Que dependa de que alguien se
-- acuerde de apretar un botón es pedir que tarde o temprano un comprador
-- quede con la inicial pagada y su lote todavía «reservado» — y venciéndose.
do $patch$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='admin_register_cuota_payment';
  if position('convertida_en_venta' in v_def) > 0 then return; end if;

  v_def := replace(v_def,
    $$  perform private.audit('team', v_actor, null,
    case when v_destino = 'cuota' then 'cuota.registered' else 'abono.registered' end,$$,
    $$  -- ¿Con este abono ya juntó la cuota inicial? Entonces esto ya no es una
  -- reserva: es una venta.
  if v_es_reserva then
    declare
      v_objetivo numeric(14,2);
      v_junto numeric(14,2);
    begin
      v_objetivo := coalesce((public.condiciones_financiamiento(v_res.project_id, v_res.price_agreed)
                              ->>'inicial_sugerida')::numeric, 0);
      select coalesce(sum(x.amount_bob), 0) into v_junto
        from public.payments x
       where x.reservation_id = p_reservation_id and x.status = 'aprobado'
         and x.purpose in ('reserva','cuota','abono');
      if v_objetivo > 0 and v_junto >= v_objetivo - 0.01 then
        perform public.admin_confirmar_reserva(p_reservation_id,
          'cuota inicial completa: ' || v_junto || ' de ' || v_objetivo);
        v_convertida := true;
      end if;
    end;
  end if;

  perform private.audit('team', v_actor, null,
    case when v_destino = 'cuota' then 'cuota.registered' else 'abono.registered' end,$$);

  -- La variable y el dato de salida.
  v_def := replace(v_def,
    '  v_i int; v_num int; v_next date; v_recalc jsonb := null;',
    '  v_i int; v_num int; v_next date; v_recalc jsonb := null;
  v_convertida boolean := false;');
  v_def := replace(v_def,
    $$    'plan_recalculado', v_recalc);$$,
    $$    'plan_recalculado', v_recalc,
    'convertida_en_venta', v_convertida);$$);

  if position('convertida_en_venta' in v_def) = 0 then
    raise exception 'PATCH_NO_APLICADO: admin_register_cuota_payment';
  end if;
  execute v_def;
end;
$patch$;
