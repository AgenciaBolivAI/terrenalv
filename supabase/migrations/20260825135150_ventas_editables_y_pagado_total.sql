-- Tres cosas que la pantalla de Ventas destapó al usarse:
--
-- 1. «Cobrado Bs 0» en todas las ventas migradas. La columna contaba solo los
--    pagos registrados ACÁ, pero esos compradores ya pagaron Bs 10,4 millones
--    en el sistema anterior (reportado.abonado). Un comprador al día aparecía
--    como si nunca hubiera pagado nada. Ahora la vista expone lo pagado allá,
--    lo cobrado acá, y el total.
--
-- 2. No había forma de EDITAR una venta. Las migradas llegaron con
--    CI «MIGRADO-...» y teléfono «s/d» a propósito (no se inventan datos), y
--    la oficina tiene que poder completarlos con el contrato en la mano —
--    además de corregir un precio o una deuda migrada mal reportada.
--
-- 3. Tampoco había forma de ANULAR una venta cargada por error.

create or replace view public.v_ventas
with (security_invoker = true) as
select r.project_id,
       r.id as reservation_id,
       r.tracking_code,
       r.buyer_full_name,
       r.buyer_ci,
       r.buyer_phone,
       r.buyer_email,
       (r.confirmed_at at time zone 'America/La_Paz')::date as fecha_venta,
       r.price_agreed,
       r.currency,
       m.code as manzana,
       l.number as lote,
       p.name as proyecto,
       (r.client_meta ? 'migrado_de') as migrada,
       coalesce((r.client_meta->'reportado'->>'deuda')::numeric, null) as deuda_migrada,
       coalesce(pg.total, 0) as cobrado_aqui,
       coalesce(pg.cuotas, 0) as pagos_cuota,
       coalesce(pg.abonos, 0) as pagos_abono,
       greatest(0, coalesce((r.client_meta->'reportado'->>'deuda')::numeric, r.price_agreed)
                   - coalesce(pg.total, 0)) as saldo,
       exists (select 1 from public.installment_plans ip
                where ip.reservation_id = r.id and ip.status = 'activo') as con_plan,
       pg.ultimo_pago,
       ((r.client_meta ? 'migrado_de') or coalesce(pg.total, 0) > 0) as compra_iniciada,
       -- Lo que el comprador pagó en el sistema anterior, según su reporte.
       coalesce((r.client_meta->'reportado'->>'abonado')::numeric, 0) as abonado_migrado,
       -- Lo pagado EN TOTAL: allá más acá. Es la columna que responde
       -- «¿cuánto lleva pagado este comprador?», que es lo que se pregunta
       -- la oficina — no en qué sistema lo pagó.
       coalesce((r.client_meta->'reportado'->>'abonado')::numeric, 0) + coalesce(pg.total, 0)
         as pagado_total
  from public.reservations r
  join public.projects p on p.id = r.project_id
  left join public.lots l on l.id = r.lot_id
  left join public.manzanas m on m.id = l.manzana_id
  left join lateral (
    select sum(x.amount_bob) as total,
           count(*) filter (where x.purpose = 'cuota') as cuotas,
           count(*) filter (where x.purpose = 'abono') as abonos,
           max((x.verified_at at time zone 'America/La_Paz')::date) as ultimo_pago
      from public.payments x
     where x.reservation_id = r.id and x.status = 'aprobado' and x.purpose <> 'reserva'
  ) pg on true
 where r.status = 'confirmada';

grant select on public.v_ventas to authenticated;

-- ================================================================ EDITAR
create or replace function public.admin_editar_venta(
  p_reservation_id uuid,
  p_full_name text default null,
  p_ci text default null,
  p_phone text default null,
  p_email text default null,
  p_price numeric default null,
  p_deuda_migrada numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid;
  v_res public.reservations%rowtype;
  v_antes jsonb;
  v_meta jsonb;
begin
  v_actor := private.assert_accounting();

  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if v_res.status <> 'confirmada' then raise exception 'NO_ES_VENTA'; end if;

  v_antes := jsonb_build_object(
    'nombre', v_res.buyer_full_name, 'ci', v_res.buyer_ci, 'tel', v_res.buyer_phone,
    'correo', v_res.buyer_email, 'precio', v_res.price_agreed,
    'deuda_migrada', v_res.client_meta->'reportado'->>'deuda');

  if p_price is not null and p_price <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_deuda_migrada is not null and p_deuda_migrada < 0 then raise exception 'INVALID_AMOUNT'; end if;
  -- La corrección de deuda migrada solo tiene sentido en una venta migrada:
  -- en una nativa el saldo sale del precio y los pagos, no de un reporte.
  if p_deuda_migrada is not null and not (v_res.client_meta ? 'migrado_de') then
    raise exception 'NO_ES_MIGRADA';
  end if;

  v_meta := v_res.client_meta;
  if p_deuda_migrada is not null then
    v_meta := jsonb_set(v_meta, '{reportado,deuda}', to_jsonb(p_deuda_migrada));
    v_meta := v_meta || jsonb_build_object('deuda_corregida_por', v_actor,
                                           'deuda_corregida_en', now());
  end if;

  update public.reservations set
    buyer_full_name = coalesce(nullif(btrim(coalesce(p_full_name, '')), ''), buyer_full_name),
    buyer_ci = coalesce(nullif(btrim(coalesce(p_ci, '')), ''), buyer_ci),
    buyer_ci_normalized = coalesce(private.normalize_ci(nullif(btrim(coalesce(p_ci, '')), '')),
                                   buyer_ci_normalized),
    buyer_phone = coalesce(nullif(btrim(coalesce(p_phone, '')), ''), buyer_phone),
    buyer_email = coalesce(lower(nullif(btrim(coalesce(p_email, '')), '')), buyer_email),
    price_agreed = coalesce(p_price, price_agreed),
    client_meta = v_meta,
    updated_at = now()
  where id = p_reservation_id;

  perform private.audit('team', v_actor, null, 'venta.editada', v_res.project_id,
    'reservation', p_reservation_id, v_antes,
    jsonb_build_object('nombre', p_full_name, 'ci', p_ci, 'tel', p_phone,
                       'correo', p_email, 'precio', p_price, 'deuda_migrada', p_deuda_migrada));

  return jsonb_build_object('ok', true);
end;
$fn$;

revoke execute on function public.admin_editar_venta(uuid, text, text, text, text, numeric, numeric)
  from public, anon;
grant execute on function public.admin_editar_venta(uuid, text, text, text, text, numeric, numeric)
  to authenticated, service_role;

-- ================================================================ ANULAR
-- Solo admin, y con nota obligatoria: anular una venta borra un hecho
-- comercial, y el porqué tiene que quedar escrito. Los pagos NO se borran —
-- son historia contable — pero el lote vuelve a la vitrina.
create or replace function public.admin_anular_venta(p_reservation_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid;
  v_res public.reservations%rowtype;
begin
  v_actor := private.assert_admin();
  if btrim(coalesce(p_note, '')) = '' then raise exception 'NOTE_REQUIRED'; end if;

  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if v_res.status <> 'confirmada' then raise exception 'NO_ES_VENTA'; end if;

  update public.reservations
     set status = 'cancelada', cancelled_at = now(), cancel_reason = btrim(p_note),
         updated_at = now()
   where id = p_reservation_id;

  update public.lots
     set status = 'disponible', active_reservation_id = null
   where id = v_res.lot_id and active_reservation_id = p_reservation_id;

  perform private.audit('team', v_actor, null, 'venta.anulada', v_res.project_id,
    'reservation', p_reservation_id,
    jsonb_build_object('comprador', v_res.buyer_full_name, 'precio', v_res.price_agreed),
    jsonb_build_object('motivo', btrim(p_note)));

  return jsonb_build_object('ok', true);
end;
$fn$;

revoke execute on function public.admin_anular_venta(uuid, text) from public, anon;
grant execute on function public.admin_anular_venta(uuid, text) to authenticated, service_role;
