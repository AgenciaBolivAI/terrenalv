-- Un banco con DOS saldos distintos según la pantalla:
--   Tesorería      → -10.000  (opening_balance 15.000 + entradas 0 - salidas 25.000)
--   Balance general→ -25.000  (sólo el libro: la apertura nunca se asentó)
--
-- El saldo inicial vivía en `treasury_accounts.opening_balance` y lo sumaba la
-- VISTA, pero jamás entró al libro. Así, la plata que la contadora declaró que
-- ya tenía el banco no existe para el balance, y el activo aparece en negativo.
--
-- Se asienta como lo que es: un comprobante de APERTURA (el tipo ya existía en
-- voucher_kind y nadie lo usaba), debitando la cuenta del banco contra
-- «3511 Resultados Acumulados», que es la contrapartida estándar de un saldo
-- que viene de antes del sistema. Vive en la Administración porque una cuenta
-- de tesorería es de la sociedad, no de una urbanización.
--
-- Y la vista deja de sumar el opening_balance por su cuenta: ahora lee el
-- libro y nada más, así que las dos pantallas no pueden volver a discrepar.
--
-- OJO para la contadora: si prefiere otra contrapartida (Capital 3111, o un
-- aporte de socio), se reclasifica con un ajuste; el importe y la fecha son los
-- que ella cargó.

-- 1) admin_upsert_treasury asienta la apertura al CREAR con saldo inicial.
create or replace function public.admin_upsert_treasury(
  p_name text, p_kind treasury_kind default 'banco'::treasury_kind,
  p_bank_name text default null, p_account_number text default null,
  p_currency character default 'BOB'::bpchar, p_opening_balance numeric default 0,
  p_opening_date date default null, p_id uuid default null,
  p_is_active boolean default true, p_ambito text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $function$
declare
  v_actor uuid;
  v_id uuid;
  v_code text;
  v_n int;
  v_entry uuid;
  v_number text;
  v_fecha date;
begin
  v_actor := private.assert_contabilidad();
  if btrim(coalesce(p_name, '')) = '' then raise exception 'NAME_REQUIRED'; end if;

  if p_id is not null then
    update public.treasury_accounts
       set name = btrim(p_name), kind = p_kind, bank_name = nullif(btrim(coalesce(p_bank_name,'')),''),
           account_number = nullif(btrim(coalesce(p_account_number,'')),''),
           currency = coalesce(p_currency,'BOB'), is_active = coalesce(p_is_active, true),
           ambito = coalesce(p_ambito, ambito),
           updated_at = now()
     where id = p_id
    returning id, account_code into v_id, v_code;
    if v_id is null then raise exception 'TREASURY_NOT_FOUND'; end if;

    update public.chart_of_accounts set name = btrim(p_name), updated_at = now() where code = v_code;
    return jsonb_build_object('id', v_id, 'account_code', v_code);
  end if;

  -- Cada cuenta nueva recibe su propia cuenta contable bajo 1111: así el mayor
  -- muestra el saldo de CADA banco y CADA caja por separado, que es lo que se
  -- compara contra un extracto.
  select count(*) + 1 into v_n from public.treasury_accounts;
  v_code := '1111.' || lpad(v_n::text, 2, '0');
  while exists (select 1 from public.chart_of_accounts where code = v_code) loop
    v_n := v_n + 1;
    v_code := '1111.' || lpad(v_n::text, 2, '0');
  end loop;

  insert into public.chart_of_accounts (code, name, kind, sort_order, parent_code, is_system)
  values (v_code, btrim(p_name), 'activo',
          (select coalesce(max(sort_order), 0) + 1 from public.chart_of_accounts where code like '1111%'),
          '1111', true);

  insert into public.treasury_accounts
    (kind, name, bank_name, account_number, currency, account_code,
     opening_balance, opening_date, created_by, ambito)
  values
    (p_kind, btrim(p_name), nullif(btrim(coalesce(p_bank_name,'')),''),
     nullif(btrim(coalesce(p_account_number,'')),''), coalesce(p_currency,'BOB'), v_code,
     coalesce(p_opening_balance, 0), p_opening_date, v_actor, coalesce(p_ambito, 'fiscal'))
  returning id into v_id;

  -- La plata que ya estaba tiene que existir en el libro, o el balance muestra
  -- el banco en negativo por los pagos que sí se asientan.
  if coalesce(p_opening_balance, 0) <> 0 then
    v_fecha := coalesce(p_opening_date, current_date);
    v_number := private.next_voucher_number('apertura');
    insert into public.journal_entries
      (project_id, number, kind, entry_date, glosa, status, is_automatic, created_by, posted_by, posted_at)
    values
      (private.proyecto_administracion(), v_number, 'apertura', v_fecha,
       format('Saldo inicial de %s', btrim(p_name)), 'registrado', true, v_actor, v_actor, now())
    returning id into v_entry;

    insert into public.journal_lines (entry_id, account_code, debe, haber, sort_order) values
      (v_entry, v_code, greatest(p_opening_balance, 0), greatest(-p_opening_balance, 0), 1),
      (v_entry, '3511', greatest(-p_opening_balance, 0), greatest(p_opening_balance, 0), 2);
  end if;

  perform private.audit('team', v_actor, null, 'treasury.created', null, 'treasury', v_id,
    null, jsonb_build_object('nombre', btrim(p_name), 'cuenta', v_code, 'tipo', p_kind,
                             'saldo_inicial', p_opening_balance));

  return jsonb_build_object('id', v_id, 'account_code', v_code);
end;
$function$;

-- 2) La apertura que falta de la única cuenta ya cargada.
do $$
declare
  r record;
  v_entry uuid;
  v_number text;
  v_actor uuid;
begin
  select created_by into v_actor from public.treasury_accounts order by created_at limit 1;
  for r in
    select t.* from public.treasury_accounts t
     where t.opening_balance <> 0
       and not exists (
         select 1 from public.journal_entries je
          join public.journal_lines jl on jl.entry_id = je.id
         where je.kind = 'apertura' and jl.account_code = t.account_code)
  loop
    v_number := private.next_voucher_number('apertura');
    insert into public.journal_entries
      (project_id, number, kind, entry_date, glosa, status, is_automatic, created_by, posted_by, posted_at)
    values
      (private.proyecto_administracion(), v_number, 'apertura',
       coalesce(r.opening_date, r.created_at::date),
       format('Saldo inicial de %s', r.name), 'registrado', true, v_actor, v_actor, now())
    returning id into v_entry;

    insert into public.journal_lines (entry_id, account_code, debe, haber, sort_order) values
      (v_entry, r.account_code, greatest(r.opening_balance, 0), greatest(-r.opening_balance, 0), 1),
      (v_entry, '3511', greatest(-r.opening_balance, 0), greatest(r.opening_balance, 0), 2);
  end loop;
end $$;

-- 3) La vista lee el LIBRO y nada más. opening_balance queda como dato de
--    referencia (lo que la contadora declaró), no como parte del saldo.
create or replace view public.v_tesoreria_saldos as
 with movimientos as (
   select d.cuenta, sum(d.debe) as debe, sum(d.haber) as haber,
          max(d.fecha) as ultimo_movimiento, count(*) as movimientos
     from public.v_libro_diario d
    group by d.cuenta
 )
 select t.id, t.kind, t.name, t.bank_name, t.account_number, t.currency, t.account_code,
        t.is_active, t.opening_balance, t.opening_date,
        coalesce(m.debe, 0::numeric)  as entradas,
        coalesce(m.haber, 0::numeric) as salidas,
        coalesce(m.debe, 0::numeric) - coalesce(m.haber, 0::numeric) as saldo,
        m.ultimo_movimiento,
        coalesce(m.movimientos, 0::bigint) as movimientos,
        t.ambito
   from public.treasury_accounts t
   left join movimientos m on m.cuenta = t.account_code;
