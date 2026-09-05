-- `saldos_de_tesoreria_coherentes` comprobaba
--     saldo = opening_balance + entradas - salidas
-- que era EXACTAMENTE la fórmula con la que la vista calculaba `saldo`. Un
-- chequeo que repite la definición de lo que mira no puede fallar nunca: pasó
-- en verde todo este tiempo mientras el banco mostraba -10.000 en una pantalla
-- y -25.000 en la otra.
--
-- Lo reemplaza un invariante de verdad, el que habría cantado ese bug: toda
-- cuenta de tesorería que declara un saldo inicial tiene que tenerlo ASENTADO
-- como comprobante de apertura. Si no, la plata existe en la pantalla y no en
-- el balance.

do $$
declare
  v_def text;
  v_viejo text := $v$  select count(*) into v_n from public.v_tesoreria_saldos
   where round(saldo, 2) <> round(opening_balance + entradas - salidas, 2);
  return query select 'saldos_de_tesoreria_coherentes'::text, (v_n = 0),
    format('%s cuenta(s) donde saldo <> inicial + entradas - salidas', v_n);$v$;
  v_nuevo text := $v$  select count(*) into v_n
    from public.treasury_accounts t
   where t.opening_balance <> 0
     and not exists (
       select 1 from public.journal_entries je
        join public.journal_lines jl on jl.entry_id = je.id
       where je.kind = 'apertura' and jl.account_code = t.account_code);
  return query select 'el_saldo_inicial_esta_asentado'::text, (v_n = 0),
    format('%s cuenta(s) con saldo inicial declarado y sin comprobante de apertura', v_n);$v$;
begin
  v_def := pg_get_functiondef('public.verificar_integridad()'::regprocedure);
  if position(v_viejo in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA: el chequeo tautológico de tesorería cambió de forma';
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $$;
