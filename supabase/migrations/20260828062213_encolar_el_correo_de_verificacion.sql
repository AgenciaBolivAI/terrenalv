-- El correo de verificación entra por el MISMO buzón que todo lo demás
-- (notifications → notification_outbox → /api/internal/deliver-outbox), así
-- que si el envío falla se reintenta en vez de perderse. Hoy sigue en cola
-- porque RESEND_API_KEY no está configurada: en cuanto exista, sale solo,
-- junto con las nueve que ya esperan.
create or replace function public.encolar_verificacion_correo(
  p_customer_id uuid,
  p_email text,
  p_nombre text,
  p_enlace text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_id uuid;
begin
  if coalesce(btrim(p_email), '') = '' or coalesce(btrim(p_enlace), '') = '' then
    raise exception 'DATOS_INCOMPLETOS';
  end if;

  v_id := private.notify(
    null,
    'sistema'::notification_type,
    'baja',
    'Confirmá tu correo en Terrenalv',
    format('%s, confirmá tu correo para que podamos avisarte de tus cuotas y saludarte en tu cumpleaños.',
           coalesce(nullif(btrim(p_nombre), ''), 'Hola')),
    'customer', p_customer_id,
    jsonb_build_object('enlace', p_enlace, 'email', p_email),
    false,
    p_email,
    'buyer_verificar_correo');

  return jsonb_build_object('ok', true, 'notification_id', v_id);
end;
$$;

revoke execute on function public.encolar_verificacion_correo(uuid, text, text, text)
  from anon, authenticated, public;
grant execute on function public.encolar_verificacion_correo(uuid, text, text, text) to service_role;
