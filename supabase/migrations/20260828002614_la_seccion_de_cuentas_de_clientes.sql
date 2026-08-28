-- La sección nueva del panel: «Cuentas» (los clientes registrados).
--
-- Una ruta que no está en estas tres listas NO queda gobernada por los
-- permisos —falla abierta a propósito, para no romper el panel— así que se
-- agrega en las tres de una: mi_acceso(), nivel_de() y el validador de
-- admin_guardar_permisos.
--
-- Default: es dato comercial de los clientes, no plata. Ventas la necesita
-- tanto como contabilidad (es a quién llamar), así que se comporta como
-- «clientes»: 'edita' para todos salvo recorte explícito del dueño.
do $$
declare v_src text;
begin
  select pg_get_functiondef(oid) into v_src
  from pg_proc where proname='mi_acceso' and pronamespace='public'::regnamespace;
  if position($x$'panel','reservas','ventas','clientes','notificaciones','mi-cuenta',$x$ in v_src) = 0 then
    raise exception 'no encontré la lista de secciones de mi_acceso';
  end if;
  execute replace(v_src,
    $x$'panel','reservas','ventas','clientes','notificaciones','mi-cuenta',$x$,
    $x$'panel','reservas','ventas','clientes','cuentas','notificaciones','mi-cuenta',$x$);
end $$;

-- El validador de admin_guardar_permisos usa la misma lista de claves.
do $$
declare v_src text;
begin
  select pg_get_functiondef(oid) into v_src
  from pg_proc where proname='admin_guardar_permisos' and pronamespace='public'::regnamespace;
  if position($x$'clientes'$x$ in v_src) = 0 then
    raise notice 'admin_guardar_permisos no lista secciones explícitamente: nada que agregar';
  else
    execute replace(v_src, $x$'clientes',$x$, $x$'clientes','cuentas',$x$);
  end if;
end $$;
