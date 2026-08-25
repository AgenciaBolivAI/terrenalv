-- El recibo sale por los DOS canales: correo y WhatsApp.
--
-- El correo ya viajaba solo. WhatsApp queda encolado igual — mismo outbox,
-- mismos reintentos — y se entrega apenas la empresa cargue las credenciales
-- de WhatsApp Business (Meta Cloud API). Sin credenciales el mensaje espera
-- en la cola y el panel lo dice; no se inventa un envío que no ocurrió.
create or replace function private.notificar_recibo(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare v_p record; v_notif uuid; v_payload jsonb;
begin
  select p.id, p.amount, p.currency, p.amount_bob, p.purpose, p.reference_code,
         r.tracking_code, r.buyer_email, r.buyer_phone, r.buyer_full_name,
         r.client_meta, r.project_id, m.code as manzana, l.number as lote
    into v_p
    from public.payments p
    join public.reservations r on r.id = p.reservation_id
    left join public.lots l on l.id = r.lot_id
    left join public.manzanas m on m.id = l.manzana_id
   where p.id = p_payment_id and p.status = 'aprobado';
  if not found then return; end if;
  if v_p.client_meta ? 'demo' or v_p.client_meta ? 'migrado_de' then return; end if;

  v_payload := jsonb_build_object(
    'tracking_code', v_p.tracking_code,
    'payment_id', v_p.id,
    'referencia', v_p.reference_code,
    'monto', v_p.amount,
    'moneda', v_p.currency,
    'monto_bob', v_p.amount_bob,
    'manzana', v_p.manzana,
    'lote', v_p.lote,
    'comprador', v_p.buyer_full_name,
    'tipo', case v_p.purpose
              when 'reserva'  then 'Reserva'
              when 'comision' then 'Comisión del mercado'
              else 'Venta' end);

  insert into public.notifications
    (project_id, type, priority, title, body, entity_type, entity_id, payload)
  values
    (v_p.project_id, 'pago_aprobado', 'normal',
     'Recibo enviado — ' || v_p.tracking_code,
     'Recibo ' || v_p.reference_code || ' por ' ||
       to_char(v_p.amount_bob, 'FM999G999G990D00') || ' Bs',
     'payment', v_p.id, v_payload)
  returning id into v_notif;

  if coalesce(v_p.buyer_email, '') <> '' and v_p.buyer_email not ilike '%@ejemplo.bo' then
    insert into public.notification_outbox (notification_id, channel, recipient, template, payload)
    values (v_notif, 'email', v_p.buyer_email, 'buyer_recibo', v_payload);
  end if;

  if coalesce(v_p.buyer_phone, '') <> '' then
    insert into public.notification_outbox (notification_id, channel, recipient, template, payload)
    values (v_notif, 'whatsapp', v_p.buyer_phone, 'buyer_recibo', v_payload);
  end if;
end;
$fn$;

-- La oficina ve el estado real de cada envío, sin entrar a la base.
create or replace view public.v_envios
with (security_invoker = true) as
select o.id,
       o.channel as canal,
       o.recipient as destinatario,
       o.template as plantilla,
       o.status as estado,
       o.attempts as intentos,
       o.last_error as ultimo_error,
       (o.sent_at at time zone 'America/La_Paz') as enviado_el,
       (o.created_at at time zone 'America/La_Paz') as encolado_el,
       o.payload->>'tracking_code' as tracking_code,
       o.payload->>'comprador' as comprador,
       (o.payload->>'monto_bob')::numeric as monto_bob,
       n.project_id
  from public.notification_outbox o
  left join public.notifications n on n.id = o.notification_id;

grant select on public.v_envios to authenticated;
