-- 1) EL CORREO NUNCA SALIÓ DE LA CASA.
--
-- `app_base_url` estaba en null, y private.ping_outbox_delivery() corta ahí
-- mismo (`if v_url is null or v_url = '' then return`). Resultado: las 9
-- notificaciones del outbox llevan desde julio en 'pendiente', net._http_response
-- no tiene una sola fila, y el cron corre cada minuto sin hacer nada. La
-- oficina no se entera de una reserva nueva, de un comprobante subido ni de
-- nada. El dominio ya está en producción y responde: se carga.
insert into public.settings (project_id, key, value, is_public)
values (null, 'app_base_url', to_jsonb('https://www.terrenalv.com'::text), false)
on conflict (project_id, key) do update set value = excluded.value;

-- 2) La consulta del mercado necesita su propio tipo de aviso. Un valor de
--    enum nuevo no se puede USAR en la misma transacción en que se agrega, así
--    que acá solo se agrega; quien lo usa viene en la migración siguiente.
alter type public.notification_type add value if not exists 'consulta_mercado';
