-- El pago de la comisión es en bolivianos: tipo de cambio 1, como exige la tabla.
do $patch$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='admin_traspasar_venta';
  if position('exchange_rate_used' in v_def) > 0 then return; end if;
  v_def := replace(v_def,
    'amount_bob, status, verified_by, verified_at, rejection_note, treasury_account_id)',
    'amount_bob, exchange_rate_used, status, verified_by, verified_at, rejection_note, treasury_account_id)');
  v_def := replace(v_def,
    $$v_fee, 'BOB', v_fee, 'aprobado', v_actor, now(),$$,
    $$v_fee, 'BOB', v_fee, 1, 'aprobado', v_actor, now(),$$);
  execute v_def;
end;
$patch$;
