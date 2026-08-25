-- Dos reparaciones de la reescritura del traspaso con comisión:
--
-- 1. El traspaso vuelve a arrastrar baseline_original y confirmado_original:
--    sin ellos el libro reconocía como venta solo el saldo del momento y el
--    ingreso del eslabón original se perdía — 1131 dejaba de cuadrar con las
--    pantallas, que es EL invariante de esta contabilidad.
-- 2. v_libro_diario recupera security_invoker=true (el create or replace lo
--    había dejado caer y la vista corría como dueña).
alter view public.v_libro_diario set (security_invoker = true);

do $patch$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='admin_traspasar_venta';
  if position('baseline_original' in v_def) > 0 then return; end if;
  v_def := replace(v_def,
    $$'saldo_arrastrado', v_saldo,
             'motivo', btrim(p_note))$$,
    $$'saldo_arrastrado', v_saldo,
             'baseline_original', coalesce(
               (v_vieja.client_meta->'traspaso'->>'baseline_original')::numeric,
               (v_vieja.client_meta->'reportado'->>'deuda')::numeric,
               v_vieja.price_agreed),
             'confirmado_original', coalesce(
               (v_vieja.client_meta->'traspaso'->>'confirmado_original')::timestamptz,
               v_vieja.confirmed_at),
             'motivo', btrim(p_note))$$);
  execute v_def;
end;
$patch$;
