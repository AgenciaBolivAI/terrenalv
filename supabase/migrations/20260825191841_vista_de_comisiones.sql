-- Cuánto ganó cada vendedor, cuánto se le pagó y cuánto se le debe.
--
-- El pago de una comisión es un EGRESO de categoría 'comisiones' (cuenta
-- 5211), como cualquier salida de plata: así aparece en el libro, en el
-- estado de resultados y en el saldo de la caja de donde salió. Se enlaza a
-- la venta por una nota estructurada en el egreso, para no inventar tablas
-- que después nadie concilia.
alter table public.expenses
  add column if not exists reservation_id uuid references public.reservations (id) on delete set null,
  add column if not exists profile_id uuid references public.profiles (id) on delete set null;

create index if not exists expenses_comision_idx
  on public.expenses (profile_id, reservation_id) where category = 'comisiones';

-- ---- Una fila por venta con vendedor: lo ganado y lo pagado.
create or replace view public.v_comisiones
with (security_invoker = true) as
select r.id as reservation_id,
       r.project_id,
       pr.name as proyecto,
       r.tracking_code,
       r.status::text as estado,
       (r.confirmed_at at time zone 'America/La_Paz')::date as fecha_venta,
       m.code as manzana,
       l.number as lote,
       r.buyer_full_name as comprador,
       r.sold_by as profile_id,
       p.full_name as vendedor,
       p.role::text as vendedor_rol,
       coalesce(r.commission_pct, 0) as pct,
       coalesce(r.commission_base, 'cobrado') as base,
       r.price_agreed as precio,
       -- Lo que el comprador lleva pagado de CAPITAL (sin intereses): es lo
       -- que de verdad entró por el lote.
       private.capital_pagado(r.id) as cobrado,
       -- Ganado: sobre el precio (todo de una) o sobre lo cobrado (de a poco).
       round(
         case when coalesce(r.commission_base, 'cobrado') = 'precio'
              then r.price_agreed
              else private.capital_pagado(r.id) end
         * coalesce(r.commission_pct, 0) / 100, 2) as ganado,
       coalesce(pg.pagado, 0) as pagado,
       greatest(0, round(
         case when coalesce(r.commission_base, 'cobrado') = 'precio'
              then r.price_agreed
              else private.capital_pagado(r.id) end
         * coalesce(r.commission_pct, 0) / 100, 2) - coalesce(pg.pagado, 0)) as por_pagar
  from public.reservations r
  join public.projects pr on pr.id = r.project_id
  left join public.profiles p on p.id = r.sold_by
  left join public.lots l on l.id = r.lot_id
  left join public.manzanas m on m.id = l.manzana_id
  left join lateral (
    select sum(e.amount_bob) as pagado
      from public.expenses e
     where e.reservation_id = r.id and e.category = 'comisiones' and e.deleted_at is null
  ) pg on true
 where r.sold_by is not null
   and (r.status = 'confirmada' or r.client_meta ? 'traspasada_a');

grant select on public.v_comisiones to authenticated;

-- ---- El resumen por persona, para la pantalla y para pagar.
create or replace view public.v_comisiones_por_vendedor
with (security_invoker = true) as
select p.id as profile_id,
       p.full_name as vendedor,
       p.role::text as rol,
       p.is_active,
       count(c.reservation_id) as ventas,
       coalesce(sum(c.precio), 0) as valor_vendido,
       coalesce(sum(c.cobrado), 0) as cobrado_de_sus_ventas,
       coalesce(sum(c.ganado), 0) as ganado,
       coalesce(sum(c.pagado), 0) as pagado,
       coalesce(sum(c.por_pagar), 0) as por_pagar,
       max(c.fecha_venta) as ultima_venta
  from public.profiles p
  left join public.v_comisiones c on c.profile_id = p.id
 where p.is_active
 group by p.id, p.full_name, p.role, p.is_active;

grant select on public.v_comisiones_por_vendedor to authenticated;

-- ---- Pagar una comisión: sale plata, así que es un egreso de verdad.
create or replace function public.admin_pagar_comision(
  p_reservation_id uuid,
  p_amount numeric,
  p_treasury_account_id uuid default null,
  p_paid_on date default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid; v_c record; v_id uuid; v_fecha date;
begin
  v_actor := private.assert_accounting();
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  select * into v_c from public.v_comisiones where reservation_id = p_reservation_id;
  if not found then raise exception 'SIN_VENDEDOR'; end if;

  -- No se paga más de lo ganado: una comisión adelantada es un préstamo, y un
  -- préstamo no es un egreso de comisiones.
  if p_amount > v_c.por_pagar + 0.01 then
    raise exception 'MONTO_EXCEDE_COMISION'
      using detail = format('ganado %s, ya pagado %s, queda %s',
                            v_c.ganado, v_c.pagado, v_c.por_pagar);
  end if;

  if p_treasury_account_id is not null
     and not exists (select 1 from public.treasury_accounts
                      where id = p_treasury_account_id and is_active) then
    raise exception 'TREASURY_NOT_FOUND';
  end if;

  v_fecha := coalesce(p_paid_on, (now() at time zone 'America/La_Paz')::date);

  insert into public.expenses
    (project_id, incurred_on, category, description, supplier, amount, currency,
     amount_bob, exchange_rate_used, note, created_by, treasury_account_id,
     reservation_id, profile_id)
  values
    (v_c.project_id, v_fecha, 'comisiones',
     'Comisión de venta ' || v_c.tracking_code || ' — ' || v_c.vendedor,
     v_c.vendedor, p_amount, 'BOB', p_amount, 1, p_note, v_actor,
     p_treasury_account_id, p_reservation_id, v_c.profile_id)
  returning id into v_id;

  perform private.audit('team', v_actor, null, 'comision.pagada', v_c.project_id,
    'reservation', p_reservation_id, null,
    jsonb_build_object('expense_id', v_id, 'vendedor', v_c.vendedor,
                       'monto', p_amount, 'ganado', v_c.ganado));

  return jsonb_build_object('expense_id', v_id, 'pagado', p_amount);
end;
$fn$;

revoke execute on function public.admin_pagar_comision(uuid, numeric, uuid, date, text)
  from public, anon;
grant execute on function public.admin_pagar_comision(uuid, numeric, uuid, date, text)
  to authenticated, service_role;

-- ---- La suite vigila que no se pague de más ni a nadie.
create or replace function private.comisiones_incoherentes()
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (select count(*) from public.v_comisiones where pagado > ganado + 0.01)
       + (select count(*) from public.expenses e
           where e.category = 'comisiones' and e.deleted_at is null
             and e.reservation_id is not null and e.profile_id is null)::int;
$$;

grant execute on function private.comisiones_incoherentes() to authenticated, service_role;
