-- Los dos feeds de la portada (Instagram y TikTok) caen en silencio a
-- publicaciones fijas cuando la red no responde. Es a propósito —la página no
-- puede quedar con un hueco— pero el silencio es el problema: desde la oficina
-- se ve una sección llena y nadie sospecha que está congelada.
--
-- Y hay algo peor, propio de Instagram: el token largo de Meta dura 60 días y
-- solo se renueva llamando a Meta CON el token actual. Hasta hoy eso pasaba
-- únicamente cuando alguien entraba a la portada. Un sitio tranquilo dos meses
-- se quedaba sin token, y recuperarlo exige que el dueño rehaga todo el trámite
-- en Meta. Una revisión diaria lo renueva sola.
--
-- Mismo mecanismo que el outbox: pg_cron pega a una ruta interna con el
-- Authorization Bearer de settings.internal_cron_secret.

create or replace function private.ping_social_check()
returns void
language plpgsql
set search_path to 'public', 'private', 'extensions'
as $function$
declare
  v_url text;
  v_secret text;
begin
  v_url := private.get_setting(null, 'app_base_url') #>> '{}';
  v_secret := private.get_setting(null, 'internal_cron_secret') #>> '{}';
  if v_url is null or v_url = '' or v_secret is null or v_secret = '' then
    return;
  end if;
  perform net.http_post(
    url := v_url || '/api/internal/social-check',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret,
                                  'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    -- Son dos redes sociales de por medio: más aire que los 8 s del outbox.
    timeout_milliseconds := 25000
  );
end;
$function$;

-- 09:20 UTC = 05:20 en Bolivia: la revisión ya está hecha cuando abren la
-- oficina, y a esa hora no compite con el resto de los trabajos.
select cron.schedule('social_check', '20 9 * * *', 'select private.ping_social_check()');
