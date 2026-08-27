-- Al agregar p_ambito quedaron DOS admin_upsert_treasury vivas: la de nueve
-- argumentos y la de diez. Postgres las ve como funciones distintas y toda
-- llamada con los argumentos de antes muere con «function is not unique».
-- Es el mismo error que ya apareció con admin_create_installment_plan.
--
-- Se borra la vieja y se rehace la nueva ENTERA, con el ámbito escrito de
-- verdad en el insert y en el update — antes el parámetro existía pero el
-- cuerpo lo ignoraba, así que la cuenta salía siempre con el default.
drop function if exists public.admin_upsert_treasury(
  text, treasury_kind, text, text, character, numeric, date, uuid, boolean);

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_upsert_treasury';

  -- El alta escribe el ámbito.
  if position('opening_balance, opening_date, created_by)' in v_def) = 0 then
    raise exception 'ANCLA_INSERT_NO_ENCONTRADA';
  end if;
  v_def := replace(v_def,
    'opening_balance, opening_date, created_by)',
    'opening_balance, opening_date, created_by, ambito)');
  if position('coalesce(p_opening_balance, 0), p_opening_date, v_actor)' in v_def) = 0 then
    raise exception 'ANCLA_VALUES_NO_ENCONTRADA';
  end if;
  v_def := replace(v_def,
    'coalesce(p_opening_balance, 0), p_opening_date, v_actor)',
    'coalesce(p_opening_balance, 0), p_opening_date, v_actor, coalesce(p_ambito, ''fiscal''))');

  -- La edición también, pero sólo si vino: null deja el ámbito como estaba.
  if position('currency = coalesce(p_currency,''BOB''), is_active = coalesce(p_is_active, true),' in v_def) = 0 then
    raise exception 'ANCLA_UPDATE_NO_ENCONTRADA';
  end if;
  v_def := replace(v_def,
    'currency = coalesce(p_currency,''BOB''), is_active = coalesce(p_is_active, true),',
    'currency = coalesce(p_currency,''BOB''), is_active = coalesce(p_is_active, true),
           ambito = coalesce(p_ambito, ambito),');

  execute v_def;
end $$;

-- Y que no quede más de una viva.
do $$
declare v_n int;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_upsert_treasury';
  if v_n <> 1 then raise exception 'QUEDARON % FIRMAS DE admin_upsert_treasury', v_n; end if;
end $$;
