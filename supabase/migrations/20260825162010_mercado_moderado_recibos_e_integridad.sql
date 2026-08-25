-- Tres hallazgos más de la auditoría:
--
-- 1. El vendedor podía «cambiar el precio» de un aviso PAUSADO por la oficina
--    y con eso reactivarlo, y re-publicar uno CERRADO por la oficina: la
--    moderación se eludía con un guardar. Ahora el estado lo maneja la
--    oficina: el vendedor edita precio y nota sin resucitar nada, y un cierre
--    de oficina bloquea la re-publicación.
-- 2. El comprador no tenía cómo volver a sus recibos desde su enlace de
--    seguimiento: get_reservation_status ahora los lista.
-- 3. verificar_integridad no vigilaba el invariante sagrado (1131 == Σ saldos)
--    ni varias coherencias nuevas, y cualquier autenticado (sin ser del
--    equipo) podía ejecutarla y leer los totales consolidados.

-- ---- 1. El mercado respeta a su moderador.
create or replace function public.mercado_publicar(
  p_tracking_code text, p_asking numeric, p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_res public.reservations%rowtype;
  v_id uuid;
  v_estado text;
  v_pct numeric;
begin
  if p_asking is null or p_asking <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  select * into v_res from public.reservations
   where tracking_code = upper(btrim(coalesce(p_tracking_code, '')));
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if v_res.status <> 'confirmada' then raise exception 'NO_ES_VENTA'; end if;

  -- Editar un aviso vivo actualiza precio y nota SIN tocar el estado: si la
  -- oficina lo pausó, pausado se queda hasta que la oficina diga.
  update public.market_listings
     set asking_price_bob = round(p_asking, 2),
         note = nullif(btrim(coalesce(p_note, '')), ''),
         updated_at = now()
   where reservation_id = v_res.id and status in ('activa','pausada')
  returning id, status into v_id, v_estado;

  if v_id is null then
    -- Un cierre de la oficina no se esquiva re-publicando.
    if exists (select 1 from public.market_listings
                where reservation_id = v_res.id and status = 'cerrada'
                  and closed_reason = 'cerrada por la oficina') then
      raise exception 'AVISO_CERRADO_POR_OFICINA';
    end if;
    v_pct := coalesce((select (value#>>'{}')::numeric from public.settings
                        where key = 'mercado_fee_pct' and project_id is null), 20);
    insert into public.market_listings (reservation_id, asking_price_bob, note, fee_pct)
    values (v_res.id, round(p_asking, 2), nullif(btrim(coalesce(p_note, '')), ''), v_pct)
    returning id into v_id;
    v_estado := 'activa';
  end if;

  perform private.audit('guest', null, null, 'mercado.publicado', v_res.project_id,
    'market_listing', v_id, null,
    jsonb_build_object('tracking', v_res.tracking_code, 'pide', p_asking, 'estado', v_estado));

  return jsonb_build_object('listing_id', v_id, 'estado', v_estado);
end;
$fn$;

-- ---- 2. El comprador vuelve a sus recibos desde su página.
create or replace function public.get_reservation_status(
  p_tracking_code text,
  p_ip_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_res public.reservations%rowtype;
  v_lot public.lots%rowtype;
  v_mz_code text;
  v_pay record;
  v_grace int;
begin
  if p_ip_hash is not null and (
      select count(*) from private.reservation_attempts
      where ip_hash = p_ip_hash and action = 'status_lookup'
        and created_at > now() - interval '1 hour') >= 200 then
    raise exception 'RATE_LIMITED';
  end if;
  perform private.log_attempt(p_ip_hash, null, null, 'status_lookup', true, null);

  select * into v_res from public.reservations
  where tracking_code = upper(btrim(p_tracking_code));
  if not found then
    raise exception 'RESERVATION_NOT_FOUND';
  end if;

  select * into v_lot from public.lots where id = v_res.lot_id;
  select code into v_mz_code from public.manzanas where id = v_lot.manzana_id;

  select p.status, p.reference_code, p.amount, p.currency, p.amount_bob,
         p.rejection_reason, p.rejection_note, p.proof_submitted_at
    into v_pay
  from public.payments p
  where p.reservation_id = v_res.id and p.purpose = 'reserva'
  order by p.created_at desc
  limit 1;

  v_grace := coalesce((private.get_setting(v_res.project_id, 'expiry_grace_minutes'))::int, 10);

  return jsonb_build_object(
    'tracking_code', v_res.tracking_code,
    'status', v_res.status,
    'server_now', now(),
    'hold_expires_at', v_res.hold_expires_at,
    'retry_expires_at', v_res.retry_expires_at,
    'grace_minutes', v_grace,
    'buyer_display', split_part(v_res.buyer_full_name, ' ', 1) || ' ' ||
                     left(split_part(v_res.buyer_full_name, ' ', 2), 1) || '.',
    'manzana', v_mz_code,
    'lote', v_lot.number,
    'sector', (select sector from public.manzanas where id = v_lot.manzana_id),
    'area_m2', v_lot.area_m2,
    'frontage_m', v_lot.frontage_m,
    'depth_m', v_lot.depth_m,
    'price_agreed', v_res.price_agreed,
    'currency', v_res.currency,
    'amount_due', v_res.amount_due,
    'amount_due_currency', v_res.amount_due_currency,
    'confirmed_at', v_res.confirmed_at,
    'cancel_reason', v_res.cancel_reason,
    'payment', case when v_pay is null then null else jsonb_build_object(
      'status', v_pay.status,
      'reference_code', v_pay.reference_code,
      'amount', v_pay.amount,
      'currency', v_pay.currency,
      'amount_bob', v_pay.amount_bob,
      'rejection_reason', v_pay.rejection_reason,
      'rejection_note', v_pay.rejection_note,
      'proof_submitted_at', v_pay.proof_submitted_at
    ) end,
    'payment_instructions', case
      when v_res.status in ('pendiente_pago', 'rechazo_reintento')
      then private.get_setting(v_res.project_id, 'payment_instructions')
    end,
    -- Sus recibos: cada pago aprobado tiene papel, y el papel se vuelve a
    -- abrir desde este mismo enlace — no hay que pedirlo de nuevo a oficina.
    'recibos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'payment_id', p.id,
               'fecha', (p.verified_at at time zone 'America/La_Paz')::date,
               'tipo', case p.purpose
                         when 'reserva'  then 'Seña / reserva'
                         when 'cuota'    then 'Cuota'
                         when 'abono'    then 'Abono'
                         when 'comision' then 'Comisión del mercado'
                         else p.purpose end,
               'amount', p.amount,
               'currency', p.currency,
               'amount_bob', p.amount_bob)
             order by p.verified_at desc)
        from public.payments p
       where p.reservation_id = v_res.id and p.status = 'aprobado'), '[]'::jsonb)
  );
end;
$$;

-- ---- 3. La suite vigila más, y solo para el equipo.
do $g$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='verificar_integridad';
  if position('FORBIDDEN' in v_def) > 0 then return; end if;

  -- El gate: un autenticado que no es del equipo no lee los libros. El
  -- service_role (npm run verify) no tiene uid y pasa.
  v_def := replace(v_def,
    $$declare
  v_d numeric; v_h numeric; v_n int; v_a numeric; v_pp numeric; v_proj uuid;
begin$$,
    $$declare
  v_d numeric; v_h numeric; v_n int; v_a numeric; v_pp numeric; v_proj uuid;
begin
  if auth.uid() is not null and not private.is_team() then
    raise exception 'FORBIDDEN';
  end if;

  -- EL invariante: la cuenta por cobrar del libro ES la suma de los saldos
  -- que ven las pantallas. Si esto se rompe, todo lo demás es decorado.
  select coalesce(sum(debe) - sum(haber), 0) into v_d from public.v_libro_diario where cuenta = '1131';
  select coalesce(sum(saldo), 0) into v_h from public.v_ventas;
  return query select 'cuenta_por_cobrar_es_la_de_pantalla'::text, (v_d = v_h),
    format('1131 %s / pantallas %s / diferencia %s', v_d, v_h, v_d - v_h);

  select count(*) into v_n from public.payments
   where status = 'aprobado' and verified_at is null;
  return query select 'todo_aprobado_tiene_fecha'::text, (v_n = 0),
    format('%s pago(s) aprobado(s) sin fecha de verificación', v_n);

  select count(*) into v_n from public.installments i
    join public.installment_plans pl on pl.id = i.plan_id
   where pl.status <> 'activo' and i.status in ('pendiente','parcial');
  return query select 'planes_muertos_sin_cuotas_vivas'::text, (v_n = 0),
    format('%s cuota(s) viva(s) en planes cancelados o completados', v_n);

  select count(*) into v_n from public.market_listings ml
    join public.reservations r on r.id = ml.reservation_id
   where ml.status in ('activa','pausada') and r.status <> 'confirmada';
  return query select 'avisos_vivos_solo_sobre_ventas_vivas'::text, (v_n = 0),
    format('%s aviso(s) del mercado sobre reservas que ya no son ventas', v_n);$$);

  if position('FORBIDDEN' in v_def) = 0 then
    raise exception 'PATCH_NO_APLICADO: verificar_integridad';
  end if;
  execute v_def;
end;
$g$;

-- ---- 4. Datos heridos que la auditoría señaló (todo es demo, pero coherente):
-- notificaciones que apuntan a reservas borradas
delete from public.notifications n
 where n.entity_type = 'reservation'
   and not exists (select 1 from public.reservations r where r.id = n.entity_id);
-- fechas imposibles de la siembra: confirmada antes de creada / pago antes de creado
update public.reservations set created_at = confirmed_at - interval '2 hours'
 where confirmed_at is not null and confirmed_at < created_at;
update public.payments set verified_at = created_at
 where verified_at is not null and verified_at < created_at;
-- cuotas «pagadas» en el futuro
update public.installments set paid_at = least(paid_at, now())
 where paid_at is not null and paid_at > now();
-- el lote reservado sin reserva viva vuelve a la vitrina
update public.lots l
   set status = 'disponible', active_reservation_id = null
 where l.deleted_at is null and l.status = 'reservado'
   and (l.active_reservation_id is null
        or not exists (select 1 from public.reservations r
                        where r.id = l.active_reservation_id
                          and r.status in ('pendiente_pago','en_verificacion','confirmada')));
