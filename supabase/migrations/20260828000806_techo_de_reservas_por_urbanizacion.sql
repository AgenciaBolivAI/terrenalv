-- UN TECHO DE RESERVAS VIVAS POR URBANIZACIÓN.
--
-- Los límites de hoy son por carnet, por teléfono y por IP. Con IPs rotativas
-- y carnets inventados —el captcha está apagado— se pueden ir tomando lotes de
-- a poco: cada reserva aceptada congela uno durante 48 horas, y sostener eso
-- deja el mapa sin nada que un comprador real pueda reservar. Ninguno de los
-- límites existentes acota el DAÑO TOTAL; solo el ritmo por atacante.
--
-- Esto sí: un tope de reservas vivas simultáneas por urbanización. Se dimensiona
-- sobre el inventario disponible (5 % , con piso de 25) para que no estorbe a la
-- demanda real —hoy Prados del Sur tiene 2.072 disponibles, o sea 103 reservas
-- vivas a la vez— y a la vez impida vaciar la vidriera.
--
-- Es un techo, no una cuota por persona: cuando se llena, la oficina lo ve y
-- decide. El mensaje no revela nada del inventario ni del atacante.
do $$
declare
  v_src text;
  v_old text := $blk$  v_max_per_ci := coalesce(private.setting_int(p_project_id, 'max_active_per_ci', 1), 1);$blk$;
  v_new text := $blk$  v_max_per_ci := coalesce(private.setting_int(p_project_id, 'max_active_per_ci', 1), 1);

  -- Techo de reservas VIVAS en la urbanización: lo único que acota el daño
  -- total cuando el atacante tiene muchas IPs y carnets inventados.
  declare
    v_vivas int;
    v_disponibles int;
    v_techo int;
  begin
    select count(*) into v_vivas
      from public.reservations r
      join public.lots l on l.id = r.lot_id
     where l.project_id = p_project_id
       and r.status in ('pendiente_pago', 'en_verificacion', 'rechazo_reintento');

    select count(*) into v_disponibles
      from public.lots l
     where l.project_id = p_project_id
       and l.state = 'published' and l.status = 'disponible';

    v_techo := coalesce(
      private.setting_int(p_project_id, 'max_reservas_vivas', null),
      greatest(25, (v_disponibles * 5) / 100));

    if v_vivas >= v_techo then
      raise exception 'RATE_LIMITED'
        using detail = 'tope de reservas simultáneas de la urbanización';
    end if;
  end;$blk$;
begin
  select pg_get_functiondef(oid) into v_src
  from pg_proc where proname='check_reservation_limits' and pronamespace='private'::regnamespace;
  if position(v_old in v_src) = 0 then
    raise exception 'no encontré el bloque de límites';
  end if;
  if (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'el bloque aparece más de una vez: parche ambiguo';
  end if;
  execute replace(v_src, v_old, v_new);
end $$;
