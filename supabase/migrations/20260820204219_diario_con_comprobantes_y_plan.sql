-- El libro diario suma los comprobantes manuales a los asientos derivados.
--
-- Solo los REGISTRADOS: un borrador es un papel a medio escribir y un anulado
-- es un asiento que se decidió que no existe. Si cualquiera de los dos entrara
-- al libro, el balance mostraría plata que nadie movió.
create or replace view public.v_libro_diario
with (security_invoker = on) as

select
  r.project_id,
  (r.confirmed_at at time zone 'America/La_Paz')::date         as fecha,
  'VTA-' || r.tracking_code                                     as comprobante,
  'Venta de lote — ' || r.buyer_full_name                       as glosa,
  '1131'::text                                                  as cuenta,
  r.price_agreed                                                as debe,
  0::numeric                                                    as haber,
  r.id                                                          as origen_id,
  'venta'::text                                                 as origen
from public.reservations r where r.confirmed_at is not null
union all
select r.project_id, (r.confirmed_at at time zone 'America/La_Paz')::date,
  'VTA-' || r.tracking_code, 'Venta de lote — ' || r.buyer_full_name,
  '4111', 0::numeric, r.price_agreed, r.id, 'venta'
from public.reservations r where r.confirmed_at is not null

union all
select p.project_id, (p.verified_at at time zone 'America/La_Paz')::date,
  'PAGO-' || p.reference_code,
  case when p.purpose = 'cuota' then 'Cobro de cuota' else 'Cobro de seña / reserva' end
    || ' — ' || r.buyer_full_name || ' (' || r.tracking_code || ')',
  '1111', p.amount_bob, 0::numeric, p.id, 'pago'
from public.payments p join public.reservations r on r.id = p.reservation_id
where p.status = 'aprobado' and p.verified_at is not null
union all
select p.project_id, (p.verified_at at time zone 'America/La_Paz')::date,
  'PAGO-' || p.reference_code,
  case when p.purpose = 'cuota' then 'Cobro de cuota' else 'Cobro de seña / reserva' end
    || ' — ' || r.buyer_full_name || ' (' || r.tracking_code || ')',
  case when r.confirmed_at is not null then '1131' else '2131' end,
  0::numeric, p.amount_bob, p.id, 'pago'
from public.payments p join public.reservations r on r.id = p.reservation_id
where p.status = 'aprobado' and p.verified_at is not null

union all
select e.project_id, e.incurred_on,
  'EGR-' || left(replace(e.id::text, '-', ''), 10),
  e.description || coalesce(' — ' || e.supplier, ''),
  case e.category
    when 'obra' then '5111' when 'comisiones' then '5211' when 'sueldos' then '5221'
    when 'publicidad' then '5311' when 'administracion' then '5411'
    when 'impuestos' then '5511' when 'financiero' then '5611' else '5911' end,
  e.amount_bob, 0::numeric, e.id, 'egreso'
from public.expenses e where e.deleted_at is null
union all
select e.project_id, e.incurred_on,
  'EGR-' || left(replace(e.id::text, '-', ''), 10),
  e.description || coalesce(' — ' || e.supplier, ''),
  '1111', 0::numeric, e.amount_bob, e.id, 'egreso'
from public.expenses e where e.deleted_at is null

union all
-- Comprobantes manuales registrados.
select
  je.project_id,
  je.entry_date,
  je.number,
  je.glosa || coalesce(' — ' || jl.glosa, ''),
  jl.account_code,
  jl.debe,
  jl.haber,
  je.id,
  'comprobante'
from public.journal_entries je
join public.journal_lines jl on jl.entry_id = je.id
where je.status = 'registrado';

-- ============================================================================
-- Plan de cuentas: alta y baja
-- ============================================================================
create or replace function public.admin_upsert_account(
  p_code text,
  p_name text,
  p_kind text,
  p_sort_order int default null,
  p_parent_code text default null,
  p_is_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid;
  v_code text;
  v_exists public.chart_of_accounts%rowtype;
begin
  v_actor := private.assert_accounting();

  v_code := regexp_replace(upper(btrim(coalesce(p_code, ''))), '[^A-Z0-9.]', '', 'g');
  if v_code = '' then raise exception 'CODE_REQUIRED'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'NAME_REQUIRED'; end if;
  if p_kind not in ('activo','pasivo','patrimonio','ingreso','gasto') then
    raise exception 'INVALID_KIND';
  end if;

  select * into v_exists from public.chart_of_accounts where code = v_code;

  -- A una cuenta del sistema se le puede cambiar el nombre, no la naturaleza:
  -- si 1111 dejara de ser activo, el balance dejaría de cuadrar solo.
  if v_exists.code is not null and v_exists.is_system and v_exists.kind <> p_kind then
    raise exception 'CUENTA_DE_SISTEMA';
  end if;

  insert into public.chart_of_accounts (code, name, kind, sort_order, parent_code, is_active)
  values (v_code, btrim(p_name), p_kind,
          coalesce(p_sort_order, (select coalesce(max(sort_order), 0) + 10 from public.chart_of_accounts)),
          nullif(btrim(coalesce(p_parent_code, '')), ''), coalesce(p_is_active, true))
  on conflict (code) do update
    set name = excluded.name,
        kind = excluded.kind,
        sort_order = excluded.sort_order,
        parent_code = excluded.parent_code,
        is_active = excluded.is_active,
        updated_at = now();

  perform private.audit('team', v_actor, null,
    case when v_exists.code is null then 'account.created' else 'account.updated' end,
    null, 'account', null,
    case when v_exists.code is null then null
         else jsonb_build_object('nombre', v_exists.name, 'tipo', v_exists.kind) end,
    jsonb_build_object('codigo', v_code, 'nombre', btrim(p_name), 'tipo', p_kind));

  return jsonb_build_object('code', v_code);
end;
$fn$;

create or replace function public.admin_delete_account(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid;
  v_acc public.chart_of_accounts%rowtype;
  v_usos int;
begin
  v_actor := private.assert_accounting();
  select * into v_acc from public.chart_of_accounts where code = p_code;
  if v_acc.code is null then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if v_acc.is_system then raise exception 'CUENTA_DE_SISTEMA'; end if;

  -- Con movimientos no se borra: se desactiva. Borrarla dejaría asientos
  -- apuntando a una cuenta que ya no existe y el libro sin explicación.
  select count(*) into v_usos from public.journal_lines where account_code = p_code;
  if v_usos > 0 then
    update public.chart_of_accounts set is_active = false, updated_at = now() where code = p_code;
    perform private.audit('team', v_actor, null, 'account.deactivated', null, 'account', null,
      null, jsonb_build_object('codigo', p_code, 'movimientos', v_usos));
    return jsonb_build_object('ok', true, 'desactivada', true, 'movimientos', v_usos);
  end if;

  delete from public.chart_of_accounts where code = p_code;
  perform private.audit('team', v_actor, null, 'account.deleted', null, 'account', null,
    jsonb_build_object('codigo', p_code, 'nombre', v_acc.name), null);
  return jsonb_build_object('ok', true, 'desactivada', false);
end;
$fn$;

revoke execute on function
  public.admin_upsert_account(text, text, text, int, text, boolean),
  public.admin_delete_account(text)
from public, anon;
grant execute on function
  public.admin_upsert_account(text, text, text, int, text, boolean),
  public.admin_delete_account(text)
to authenticated, service_role;
