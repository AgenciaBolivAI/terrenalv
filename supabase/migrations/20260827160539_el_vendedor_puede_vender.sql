-- El rol ventas no podía VENDER: mark_sold_offline y la reserva de oficina
-- exigían rol admin, y cobrar la seña exigía contabilidad — puertas escritas
-- cuando solo existían admins. Beymar, vendedor real, rebotaba en todas.
--
-- Se abren al EQUIPO las cuatro puertas del mostrador:
--   vender en oficina, reservar en oficina, cobrar la seña, y armar el plan
--   de cuotas EN la venta (la venta a crédito lo crea por dentro).
--
-- Lo que NO se abre: confirmar reservas, registrar cuotas, editar planes,
-- anular — eso sigue siendo de contabilidad/admin. Y el candado nuevo:
-- un vendedor solo puede asignarse la venta A SÍ MISMO y SIN tocar el
-- porcentaje (el % lo pone la escala del Directorio o la regla pactada;
-- que el vendedor se escriba su propia comisión sería zorro cuidando
-- gallinero).

do $$
declare
  v_def text;
  fn text;
begin
  -- assert_admin -> assert_team en las puertas del mostrador
  foreach fn in array array['mark_sold_offline', 'admin_reserve_offline_base'] loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn
     limit 1;
    if position('private.assert_admin()' in v_def) = 0 then
      raise exception 'PARCHE_%_NO_AGARRA', fn;
    end if;
    v_def := replace(v_def, 'private.assert_admin()', 'private.assert_team()');
    execute v_def;
  end loop;

  -- assert_accounting -> assert_team en cobrar la seña y crear el plan
  foreach fn in array array['admin_cobrar_sena', 'admin_create_installment_plan'] loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn
     limit 1;
    if position('private.assert_accounting()' in v_def) = 0 then
      raise exception 'PARCHE_%_NO_AGARRA', fn;
    end if;
    v_def := replace(v_def, 'private.assert_accounting()', 'private.assert_team()');
    execute v_def;
  end loop;

  -- admin_asignar_vendedor: se abre al equipo PERO con el candado del zorro.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_asignar_vendedor';
  if position('v_actor := private.assert_accounting();' in v_def) = 0 then
    raise exception 'PARCHE_ASIGNAR_NO_AGARRA';
  end if;
  v_def := replace(v_def,
    'v_actor := private.assert_accounting();',
    'v_actor := private.assert_team();
  -- Un vendedor solo se asigna a sí mismo, y sin tocar el porcentaje: el %
  -- lo pone la escala del Directorio o la regla pactada, no el interesado.
  if exists (select 1 from public.profiles pf
              where pf.id = v_actor and pf.role = ''ventas'') then
    if p_profile_id is distinct from v_actor then
      raise exception ''SOLO_TU_PROPIA_VENTA''
        using detail = ''Un vendedor se asigna sus propias ventas; reasignar la de otro lo hace contabilidad.'';
    end if;
    if p_pct is not null then
      raise exception ''PCT_NO_ES_TUYO''
        using detail = ''El porcentaje lo pone la escala del Directorio, no el vendedor.'';
    end if;
  end if;');
  execute v_def;
end $$;
