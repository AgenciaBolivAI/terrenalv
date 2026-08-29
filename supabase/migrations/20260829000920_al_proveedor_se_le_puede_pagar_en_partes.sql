-- PAGOS PARCIALES.
--
-- Hasta acá una factura a crédito se cancelaba entera o no se cancelaba: dos
-- columnas en el egreso (`pagado_el`, `pagado_de`) y listo. En la calle no
-- funciona así — se abona a cuenta, se paga el resto a fin de mes, y el
-- proveedor manda un recibo por cada abono.
--
-- Cada pago pasa a ser un documento con su número, igual que el egreso tiene
-- el suyo. `pagado_el`/`pagado_de` quedan como MARCA de «ya se saldó del
-- todo», que es lo que la pantalla filtra; la verdad de cuánto se pagó son los
-- pagos, y de ahí sale el asiento.
--
-- La misma tabla sirve para el egreso y para el activo comprado a crédito: es
-- la misma deuda con el mismo proveedor, y tenerla en dos tablas sería tener
-- dos maneras de calcular el mismo saldo.

create table if not exists public.pagos_a_proveedor (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  expense_id uuid references public.expenses (id),
  activo_id uuid references public.fixed_assets (id),
  fecha date not null,
  numero text,
  monto numeric(14,2) not null check (monto > 0),
  treasury_account_id uuid references public.treasury_accounts (id),
  nota text,
  anulado_nota text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- Un pago paga UNA cosa: o un egreso o un activo, nunca las dos ni ninguna.
  constraint pagos_a_proveedor_destino_check
    check ((expense_id is not null) <> (activo_id is not null))
);

comment on table public.pagos_a_proveedor is
  'Cada abono a una factura de proveedor o a un activo comprado a crédito. El '
  'saldo de la deuda es el importe del documento menos la suma de sus pagos.';

create index if not exists pagos_proveedor_egreso_idx
  on public.pagos_a_proveedor (expense_id) where deleted_at is null;
create index if not exists pagos_proveedor_activo_idx
  on public.pagos_a_proveedor (activo_id) where deleted_at is null;

create or replace function private.next_pago_proveedor_number()
returns text
language plpgsql
set search_path to 'public', 'private'
as $$
declare v_n int;
begin
  perform pg_advisory_xact_lock(hashtext('comprobante:pago_proveedor'));
  select coalesce(max(substring(numero from '[0-9]+$')::int), 0) + 1
    into v_n from public.pagos_a_proveedor;
  return 'PP-' || lpad(v_n::text, 4, '0');
end;
$$;

create or replace function private.tg_pago_proveedor_numero()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
begin
  if new.numero is null then new.numero := private.next_pago_proveedor_number(); end if;
  return new;
end;
$$;

drop trigger if exists pagos_proveedor_numero on public.pagos_a_proveedor;
create trigger pagos_proveedor_numero before insert on public.pagos_a_proveedor
  for each row execute function private.tg_pago_proveedor_numero();

create unique index if not exists pagos_proveedor_numero_uidx
  on public.pagos_a_proveedor (numero) where numero is not null;

drop trigger if exists pagos_proveedor_solo_lectura on public.pagos_a_proveedor;
create trigger pagos_proveedor_solo_lectura
  before insert or update or delete on public.pagos_a_proveedor
  for each row execute function private.tg_solo_lectura('contabilidad');

alter table public.pagos_a_proveedor enable row level security;
drop policy if exists pagos_proveedor_read on public.pagos_a_proveedor;
create policy pagos_proveedor_read on public.pagos_a_proveedor
  for select to authenticated using (private.is_team());

revoke insert, update, delete on public.pagos_a_proveedor from authenticated, anon;
grant select on public.pagos_a_proveedor to authenticated;

-- ---------------------------------------------------------------------------
-- El sueldo devengado también es una deuda, pero con el personal: va contra
-- 2.01.07.010 SUELDOS POR PAGAR y no contra proveedores.
-- ---------------------------------------------------------------------------
alter table public.expenses drop constraint if exists expenses_forma_pago_check;
alter table public.expenses add constraint expenses_forma_pago_check
  check (forma_pago in ('contado','credito','fondos_por_rendir','planilla'));

alter table public.expenses drop constraint if exists expenses_credito_check;
alter table public.expenses add constraint expenses_credito_check
  check (forma_pago in ('credito','planilla')
         or (vencimiento is null and pagado_el is null and pagado_de is null));

comment on column public.expenses.forma_pago is
  'contado = salió de una caja o banco · credito = se le debe al proveedor '
  '(2.01.04.010) · fondos_por_rendir = lo gastó alguien con plata entregada '
  'por adelantado (1.02.04.030) · planilla = sueldo devengado que se le debe '
  'al personal (2.01.07.010).';

-- ---------------------------------------------------------------------------
-- Cuánto se pagó y cuánto falta, en un solo lugar.
-- ---------------------------------------------------------------------------
create or replace function private.pagado_de_egreso(p_expense_id uuid)
returns numeric
language sql
stable
set search_path to 'public'
as $$
  select coalesce(sum(monto), 0) from public.pagos_a_proveedor
   where expense_id = p_expense_id and deleted_at is null;
$$;

create or replace function private.pagado_de_activo(p_activo_id uuid)
returns numeric
language sql
stable
set search_path to 'public'
as $$
  select coalesce(sum(monto), 0) from public.pagos_a_proveedor
   where activo_id = p_activo_id and deleted_at is null;
$$;

grant execute on function private.pagado_de_egreso(uuid) to authenticated;
grant execute on function private.pagado_de_activo(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Pagar, en parte o del todo. Sin monto se paga el saldo entero.
-- ---------------------------------------------------------------------------
create or replace function public.admin_pagar_egreso(
  p_expense_id uuid,
  p_treasury_account_id uuid,
  p_fecha date default current_date,
  p_monto numeric default null,
  p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid; v_e public.expenses%rowtype; v_fecha date; v_saldo numeric; v_monto numeric; v_num text;
begin
  v_actor := private.assert_contabilidad();
  select * into v_e from public.expenses where id = p_expense_id for update;
  if v_e.id is null or v_e.deleted_at is not null then raise exception 'EGRESO_NO_ENCONTRADO'; end if;
  if v_e.forma_pago not in ('credito','planilla') then
    raise exception 'EGRESO_NO_ES_A_CREDITO'
      using detail = 'Ese egreso no quedó debiéndose: no hay nada que cancelar.';
  end if;

  v_saldo := round(v_e.amount_bob - private.pagado_de_egreso(p_expense_id), 2);
  if v_saldo <= 0 then raise exception 'EGRESO_YA_PAGADO'; end if;

  v_monto := round(coalesce(p_monto, v_saldo), 2);
  if v_monto <= 0 then raise exception 'IMPORTE_CERO'; end if;
  if v_monto > v_saldo then
    raise exception 'PAGO_MAYOR_AL_SALDO'
      using detail = format('Quedan Bs %s por pagar.', v_saldo);
  end if;

  if not exists (select 1 from public.treasury_accounts where id = p_treasury_account_id and is_active) then
    raise exception 'TREASURY_NOT_FOUND';
  end if;
  v_fecha := coalesce(p_fecha, current_date);
  if v_fecha < v_e.incurred_on then
    raise exception 'FECHA_INVALIDA' using detail = 'No se puede pagar antes de la fecha del gasto.';
  end if;
  perform private.assert_periodo_abierto(v_e.project_id, v_fecha);

  insert into public.pagos_a_proveedor
    (project_id, expense_id, fecha, monto, treasury_account_id, nota, created_by)
  values (v_e.project_id, p_expense_id, v_fecha, v_monto, p_treasury_account_id,
          nullif(btrim(coalesce(p_nota, '')), ''), v_actor)
  returning numero into v_num;

  -- La marca de «saldado» se pone sola cuando ya no queda nada.
  if round(v_e.amount_bob - private.pagado_de_egreso(p_expense_id), 2) <= 0 then
    update public.expenses
       set pagado_el = v_fecha, pagado_de = p_treasury_account_id, updated_at = now()
     where id = p_expense_id;
  end if;

  perform private.audit('team', v_actor, null, 'egreso.pagado', v_e.project_id,
    'expense', p_expense_id, null,
    jsonb_build_object('numero', v_num, 'monto', v_monto, 'fecha', v_fecha,
                       'saldo_restante', round(v_e.amount_bob - private.pagado_de_egreso(p_expense_id), 2)));
  return jsonb_build_object('ok', true, 'numero', v_num, 'monto', v_monto,
    'saldo', round(v_e.amount_bob - private.pagado_de_egreso(p_expense_id), 2));
end;
$$;

create or replace function public.admin_pagar_activo(
  p_activo_id uuid,
  p_treasury_account_id uuid,
  p_fecha date default current_date,
  p_monto numeric default null,
  p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid; v_a public.fixed_assets%rowtype; v_fecha date; v_saldo numeric; v_monto numeric; v_num text;
begin
  v_actor := private.assert_contabilidad();
  select * into v_a from public.fixed_assets where id = p_activo_id for update;
  if v_a.id is null then raise exception 'ACTIVO_NO_ENCONTRADO'; end if;
  if v_a.forma_pago <> 'credito' then
    raise exception 'ACTIVO_NO_ES_A_CREDITO'
      using detail = 'Ese activo no quedó debiéndose: no hay nada que cancelar.';
  end if;

  v_saldo := round(v_a.costo - private.pagado_de_activo(p_activo_id), 2);
  if v_saldo <= 0 then raise exception 'ACTIVO_YA_PAGADO'; end if;

  v_monto := round(coalesce(p_monto, v_saldo), 2);
  if v_monto <= 0 then raise exception 'IMPORTE_CERO'; end if;
  if v_monto > v_saldo then
    raise exception 'PAGO_MAYOR_AL_SALDO'
      using detail = format('Quedan Bs %s por pagar.', v_saldo);
  end if;

  if not exists (select 1 from public.treasury_accounts where id = p_treasury_account_id and is_active) then
    raise exception 'TREASURY_NOT_FOUND';
  end if;
  v_fecha := coalesce(p_fecha, current_date);
  if v_fecha < v_a.fecha_compra then
    raise exception 'FECHA_INVALIDA' using detail = 'No se puede pagar antes de la compra.';
  end if;
  perform private.assert_periodo_abierto(v_a.project_id, v_fecha);

  insert into public.pagos_a_proveedor
    (project_id, activo_id, fecha, monto, treasury_account_id, nota, created_by)
  values (v_a.project_id, p_activo_id, v_fecha, v_monto, p_treasury_account_id,
          nullif(btrim(coalesce(p_nota, '')), ''), v_actor)
  returning numero into v_num;

  if round(v_a.costo - private.pagado_de_activo(p_activo_id), 2) <= 0 then
    update public.fixed_assets
       set pagado_el = v_fecha, pagado_de = p_treasury_account_id, updated_at = now()
     where id = p_activo_id;
  end if;

  perform private.audit('team', v_actor, null, 'activo.pagado', v_a.project_id,
    'fixed_asset', p_activo_id, null,
    jsonb_build_object('numero', v_num, 'monto', v_monto, 'fecha', v_fecha));
  return jsonb_build_object('ok', true, 'numero', v_num, 'monto', v_monto,
    'saldo', round(v_a.costo - private.pagado_de_activo(p_activo_id), 2));
end;
$$;

-- Anular UN pago, no todos: si se cargó de más, se saca ese abono.
create or replace function public.admin_anular_pago_a_proveedor(p_id uuid, p_nota text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid; v_p public.pagos_a_proveedor%rowtype;
begin
  v_actor := private.assert_contabilidad();
  if btrim(coalesce(p_nota, '')) = '' then raise exception 'NOTE_REQUIRED'; end if;
  select * into v_p from public.pagos_a_proveedor where id = p_id for update;
  if v_p.id is null then raise exception 'PAGO_NO_ENCONTRADO'; end if;
  if v_p.deleted_at is not null then raise exception 'PAGO_YA_ANULADO'; end if;
  perform private.assert_periodo_abierto(v_p.project_id, v_p.fecha);

  update public.pagos_a_proveedor
     set deleted_at = now(), anulado_nota = btrim(p_nota), updated_at = now()
   where id = p_id;

  -- Al sacar un pago el documento vuelve a deber.
  if v_p.expense_id is not null then
    update public.expenses set pagado_el = null, pagado_de = null, updated_at = now()
     where id = v_p.expense_id;
  else
    update public.fixed_assets set pagado_el = null, pagado_de = null, updated_at = now()
     where id = v_p.activo_id;
  end if;

  perform private.audit('team', v_actor, null, 'pago_proveedor.anulado', v_p.project_id,
    'pago_proveedor', p_id, jsonb_build_object('numero', v_p.numero, 'monto', v_p.monto),
    jsonb_build_object('nota', btrim(p_nota)));
  return jsonb_build_object('ok', true);
end;
$$;

drop function if exists public.admin_anular_pago_de_egreso(uuid, text);
drop function if exists public.admin_anular_pago_de_activo(uuid, text);
drop function if exists public.admin_pagar_egreso(uuid, uuid, date);
drop function if exists public.admin_pagar_activo(uuid, uuid, date);

grant execute on function public.admin_pagar_egreso(uuid, uuid, date, numeric, text) to authenticated;
grant execute on function public.admin_pagar_activo(uuid, uuid, date, numeric, text) to authenticated;
grant execute on function public.admin_anular_pago_a_proveedor(uuid, text) to authenticated;
revoke execute on function public.admin_pagar_egreso(uuid, uuid, date, numeric, text) from anon;
revoke execute on function public.admin_pagar_activo(uuid, uuid, date, numeric, text) from anon;
revoke execute on function public.admin_anular_pago_a_proveedor(uuid, text) from anon;
