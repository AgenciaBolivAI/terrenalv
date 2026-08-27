-- Hoy pasó en producción: la contadora, probando, cargó un ajuste manual que
-- debitaba 1131 por Bs 1.500 — y el cuadre libro=pantallas se rompió al
-- instante, porque esa cuenta LA DERIVA EL SISTEMA de ventas y cobros. El
-- error no fue de ella: fue del sistema, que aceptó una cuenta que jamás
-- debió aceptar a mano. Las cuentas de integración se bloquean para asientos
-- manuales, igual que en CONTAB. (5811/1290 de depreciación NO: esas sí van
-- por comprobante — el que emite admin_depreciar_mes.)
do $$
declare
  v_def text;
  v_ancla text;
  v_freno text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_save_voucher';

  v_ancla := 'if not exists (select 1 from public.chart_of_accounts
                    where code = v_line->>''account_code'' and is_active) then
      raise exception ''CUENTA_INVALIDA'';
    end if;';
  if position(v_ancla in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA';
  end if;

  v_freno := '
    if (v_line->>''account_code'') in
       (''1131'',''2131'',''4111'',''4211'',''4311'',''4411'',''1151'',''5121'') then
      raise exception ''CUENTA_DEL_SISTEMA''
        using detail = format(''La cuenta %s la mueve el sistema solo, desde las ventas y los cobros. Ajustala desde la operación (la venta, el cobro, la anulación), no por asiento manual: así el libro y las pantallas siempre dicen lo mismo.'', v_line->>''account_code'');
    end if;';

  v_def := replace(v_def, v_ancla, v_ancla || v_freno);
  execute v_def;
end $$;
