-- Dos pedidos del mostrador:
--
-- 1. VENDER EN OFICINA ahora clasifica de verdad: modalidad (contado o
--    crédito con cuota inicial), moneda (Bs o $us con su cambio del día),
--    precio pactado si se negoció, y a qué cuenta entró la plata. Con las
--    mismas guardas del cobro: nada de cobrar más que el precio.
-- 2. RECIBO AUTOMÁTICO: todo pago que queda aprobado — por la vía que sea —
--    le manda al comprador su recibo por correo, con el enlace que ya conoce.
--    (WhatsApp automático necesita la API de WhatsApp Business; los botones
--    de un clic siguen en cada pantalla.)

-- ---- 1. El recibo viaja solo.
create or replace function private.notificar_recibo(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare v_p record;
begin
  select p.id, p.amount, p.currency, p.amount_bob, p.purpose, p.reference_code,
         r.tracking_code, r.buyer_email, r.buyer_full_name, r.client_meta, r.project_id,
         m.code as manzana, l.number as lote
    into v_p
    from public.payments p
    join public.reservations r on r.id = p.reservation_id
    left join public.lots l on l.id = r.lot_id
    left join public.manzanas m on m.id = l.manzana_id
   where p.id = p_payment_id and p.status = 'aprobado';
  if not found then return; end if;
  -- Sin correo no hay envío; y ni los datos de demo ni una importación masiva
  -- del sistema anterior deben disparar correos de verdad.
  if coalesce(v_p.buyer_email, '') = ''
     or v_p.buyer_email ilike '%@ejemplo.bo'
     or v_p.client_meta ? 'demo'
     or v_p.client_meta ? 'migrado_de' then
    return;
  end if;

  perform private.notify(
    v_p.project_id, 'pago_aprobado', 'normal',
    'Recibo enviado — ' || v_p.tracking_code,
    'Recibo ' || v_p.reference_code || ' por ' ||
      to_char(v_p.amount_bob, 'FM999G999G990D00') || ' Bs enviado a ' || v_p.buyer_email,
    'payment', v_p.id,
    jsonb_build_object(
      'tracking_code', v_p.tracking_code,
      'payment_id', v_p.id,
      'referencia', v_p.reference_code,
      'monto', v_p.amount,
      'moneda', v_p.currency,
      'monto_bob', v_p.amount_bob,
      'manzana', v_p.manzana,
      'lote', v_p.lote,
      'tipo', case v_p.purpose
                when 'reserva'  then 'Reserva'
                when 'comision' then 'Comisión del mercado'
                else 'Venta' end),
    false, v_p.buyer_email, 'buyer_recibo');
end;
$fn$;

-- El gancho: CUALQUIER pago que quede aprobado manda su recibo — venga del
-- mostrador, de la verificación de un comprobante, de un traspaso del mercado
-- o de lo que se construya mañana. Un solo mecanismo, imposible de olvidar.
create or replace function private.tg_recibo_automatico()
returns trigger
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
begin
  if new.status = 'aprobado'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform private.notificar_recibo(new.id);
  end if;
  return null;
end;
$fn$;

drop trigger if exists payments_recibo_automatico on public.payments;
create trigger payments_recibo_automatico
  after insert or update of status on public.payments
  for each row execute function private.tg_recibo_automatico();

-- ---- 2. Vender en oficina, clasificado.
drop function if exists public.mark_sold_offline(
  uuid, text, text, text, text, numeric, text, public.payment_provider_kind);

create or replace function public.mark_sold_offline(
  p_lot_id uuid, p_full_name text, p_ci text, p_phone text,
  p_email text default null, p_amount numeric default null, p_note text default null,
  p_provider public.payment_provider_kind default 'manual_qr',
  p_modalidad text default null,
  p_currency char(3) default 'BOB',
  p_exchange_rate numeric default null,
  p_treasury_account_id uuid default null,
  p_price numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $function$
declare
  v_actor uuid; v_lot public.lots%rowtype; v_project public.projects%rowtype;
  v_mz_code text; v_price numeric(12,2); v_rate numeric(10,4);
  v_cur char(3); v_amount numeric(12,2); v_amount_bob numeric(12,2);
  v_modalidad text;
  v_code text; v_ref text; v_res_id uuid; v_email text; v_pay_id uuid;
begin
  v_actor := private.assert_admin();
  v_email := private.exigir_correo(p_email);

  v_cur := upper(coalesce(nullif(btrim(coalesce(p_currency, '')), ''), 'BOB'));
  if v_cur not in ('BOB','USD') then raise exception 'INVALID_CURRENCY'; end if;
  if p_modalidad is not null and p_modalidad not in ('contado','credito') then
    raise exception 'INVALID_MODALIDAD';
  end if;
  if p_price is not null and p_price <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_treasury_account_id is not null
     and not exists (select 1 from public.treasury_accounts
                      where id = p_treasury_account_id and is_active) then
    raise exception 'TREASURY_NOT_FOUND';
  end if;

  update public.lots set status = 'vendido'
   where id = p_lot_id and status = 'disponible' and deleted_at is null
  returning * into v_lot;
  if not found then raise exception 'LOT_NOT_AVAILABLE'; end if;

  select * into v_project from public.projects where id = v_lot.project_id;
  select code into v_mz_code from public.manzanas where id = v_lot.manzana_id;

  -- El precio: el de lista, salvo pacto distinto en el mostrador.
  v_price := coalesce(p_price, public.lot_price(v_lot.id), 0);

  v_rate := coalesce(p_exchange_rate,
                     (private.get_setting(v_lot.project_id, 'exchange_rate_bob_per_usd'))::numeric,
                     6.96);
  if v_cur = 'USD' and (v_rate < 1 or v_rate > 100) then
    raise exception 'INVALID_EXCHANGE_RATE';
  end if;

  v_amount := coalesce(p_amount, case when v_cur = 'BOB' then v_price
                                      else round(v_price / v_rate, 2) end);
  v_amount_bob := case when v_cur = 'BOB' then v_amount else round(v_amount * v_rate, 2) end;

  -- Las guardas del cobro valen también acá: ni más que el precio, ni un
  -- «contado» que no lo cubra.
  if v_amount_bob > v_price + 0.01 then
    raise exception 'MONTO_EXCEDE_SALDO'
      using detail = format('precio %s, cobro %s', v_price, v_amount_bob);
  end if;
  v_modalidad := coalesce(p_modalidad,
                          case when v_amount_bob >= v_price - 0.01 then 'contado' else 'credito' end);
  if v_modalidad = 'contado' and v_amount_bob < v_price - 0.01 then
    raise exception 'MONTO_NO_CUBRE_CONTADO'
      using detail = format('precio %s, cobro %s', v_price, v_amount_bob);
  end if;

  v_code := private.gen_tracking_code(v_project.tracking_prefix);
  insert into public.reservations
    (project_id, lot_id, tracking_code, buyer_full_name, buyer_ci, buyer_ci_normalized,
     buyer_phone, buyer_email, status, price_agreed, amount_due, amount_due_currency,
     currency, source, verified_by, confirmed_at, client_meta)
  values
    (v_lot.project_id, v_lot.id, v_code, btrim(p_full_name), p_ci, private.normalize_ci(p_ci),
     private.normalize_phone_bo(p_phone), v_email, 'confirmada',
     v_price, v_amount, v_project.currency, v_project.currency, 'oficina', v_actor, now(),
     jsonb_build_object('origen', 'oficina_directa', 'modalidad', v_modalidad))
  returning id into v_res_id;

  update public.lots set active_reservation_id = v_res_id where id = v_lot.id;

  if v_amount > 0 then
    v_ref := v_project.tracking_prefix || '-' || replace(v_mz_code, '-', '') || '-'
             || v_lot.number || '-' || private.gen_code(4);
    insert into public.payments
      (project_id, reservation_id, provider, reference_code, purpose, amount, currency,
       amount_bob, exchange_rate_used, status, verified_by, verified_at, rejection_note,
       treasury_account_id)
    values
      (v_lot.project_id, v_res_id, coalesce(p_provider, 'manual_qr'), v_ref, 'abono',
       v_amount, v_cur, v_amount_bob, v_rate, 'aprobado', v_actor, now(), p_note,
       p_treasury_account_id)
    returning id into v_pay_id;
  end if;

  perform private.audit('team', v_actor, null, 'lot.sold_offline', v_lot.project_id,
    'reservation', v_res_id, null,
    jsonb_build_object('lot_id', v_lot.id, 'monto', v_amount, 'moneda', v_cur,
                       'cambio', v_rate, 'monto_bob', v_amount_bob,
                       'modalidad', v_modalidad, 'precio', v_price,
                       'origen', 'oficina_directa',
                       'forma_de_pago', coalesce(p_provider, 'manual_qr'), 'nota', p_note));

  return jsonb_build_object('tracking_code', v_code, 'reservation_id', v_res_id,
                            'payment_id', v_pay_id, 'modalidad', v_modalidad);
end;
$function$;

revoke execute on function public.mark_sold_offline(
  uuid, text, text, text, text, numeric, text, public.payment_provider_kind,
  text, char, numeric, uuid, numeric) from public, anon;
grant execute on function public.mark_sold_offline(
  uuid, text, text, text, text, numeric, text, public.payment_provider_kind,
  text, char, numeric, uuid, numeric)
  to authenticated, service_role;
