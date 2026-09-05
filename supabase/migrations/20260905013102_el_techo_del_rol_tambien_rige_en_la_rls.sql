-- AUDITORÍA 03/09/2026 — el agujero más grande que apareció.
--
-- `private.nivel_de` pone el techo del rol: contabilidad, fiscal, activos,
-- inventario y rrhh son de Contabilidad, y un permiso escrito a mano recorta
-- debajo del techo pero nunca lo levanta. Eso se aplicó a las PANTALLAS y a
-- algunas vistas… pero NO a la RLS de las tablas.
--
-- Reproducido en vivo con la sesión del perfil `ventas` (Beymar):
--
--   mi_acceso()        -> contabilidad=no rrhh=no fiscal=no activos=no inventario=no
--   ve_contabilidad()  -> false
--   select count(*) from journal_entries      -> 6 filas
--   select count(*) from journal_lines        -> 16 filas
--   select count(*) from expenses             -> 1 fila
--   select count(*) from treasury_accounts    -> 1 fila (banco y nº de cuenta)
--   select count(*) from fiscal_comprobantes  -> 1 fila
--   select count(*) from fixed_assets         -> 1 fila
--
-- O sea: el panel le dice que no y la base se lo entrega igual por REST. Las
-- tablas de esas cinco secciones estaban con `is_team()` (cualquiera del
-- equipo) y el libro con `is_accounting()` — que HONRA el permiso guardado, y
-- Beymar tiene `contabilidad: edita` escrito a mano. Hoy hr_empleados y
-- land_parcels están vacías; el día que la contadora cargue al personal, un
-- vendedor leería sueldos, CI, AFP y cuentas bancarias del plantel.
--
-- QUÉ NO SE TOCA, y por qué: `private.is_accounting()` queda igual. Es la
-- puerta floja del mostrador y gatea ~49 RPC, entre ellas confirmar reservas y
-- cobrar cuotas. El permiso `contabilidad: edita` de Beymar es LO QUE LE DEJA
-- VENDER: sacárselo rompería la caja. El agujero no era la puerta: era la RLS.

-- ---------------------------------------------------------------- RRHH
alter policy hr_empleados_lee      on public.hr_empleados
  using ((select private.nivel_de((select auth.uid()), 'rrhh')) <> 'no');
alter policy hr_planillas_lee      on public.hr_planillas
  using ((select private.nivel_de((select auth.uid()), 'rrhh')) <> 'no');
alter policy hr_planilla_items_lee on public.hr_planilla_items
  using ((select private.nivel_de((select auth.uid()), 'rrhh')) <> 'no');
alter policy hr_documentos_read    on public.hr_documentos
  using ((select private.nivel_de((select auth.uid()), 'rrhh')) <> 'no');

-- ------------------------------------------------------------- ACTIVOS
alter policy fixed_assets_lee     on public.fixed_assets
  using ((select private.nivel_de((select auth.uid()), 'activos')) <> 'no');
alter policy asset_categories_lee on public.asset_categories
  using ((select private.nivel_de((select auth.uid()), 'activos')) <> 'no');

-- ---------------------------------------------------------- INVENTARIO
alter policy land_parcels_lee on public.land_parcels
  using ((select private.nivel_de((select auth.uid()), 'inventario')) <> 'no');

-- -------------------------------------------------------------- FISCAL
alter policy fiscal_comprobantes_lee on public.fiscal_comprobantes
  using ((select private.nivel_de((select auth.uid()), 'fiscal')) <> 'no');
alter policy fiscal_lineas_lee       on public.fiscal_lineas
  using ((select private.nivel_de((select auth.uid()), 'fiscal')) <> 'no');
alter policy fiscal_exclusiones_lee  on public.fiscal_exclusiones
  using ((select private.nivel_de((select auth.uid()), 'fiscal')) <> 'no');
alter policy fiscal_facturas_lee     on public.fiscal_facturas
  using ((select private.nivel_de((select auth.uid()), 'fiscal')) <> 'no');
alter policy fiscal_parametros_lee   on public.fiscal_parametros
  using ((select private.nivel_de((select auth.uid()), 'fiscal')) <> 'no');

-- ------------------------------------------------------- EL LIBRO
-- La misma puerta que ya usan las vistas del libro.
alter policy entries_read   on public.journal_entries  using (private.ve_contabilidad());
alter policy lines_read     on public.journal_lines    using (private.ve_contabilidad());
alter policy expenses_read  on public.expenses         using (private.ve_contabilidad());
alter policy periods_read   on public.fiscal_periods   using (private.ve_contabilidad());
alter policy fondos_read    on public.fondos_a_rendir  using (private.ve_contabilidad());
alter policy pagos_proveedor_read on public.pagos_a_proveedor using (private.ve_contabilidad());

-- ---------------------------------------------------------- TESORERÍA
-- Ésta va al REVÉS a propósito: de `is_accounting()` a `is_team()`. La
-- vendedora que registra una venta en oficina TIENE que decir a qué banco
-- entró la plata (el CuentaSelect de «Depositado en»), así que necesita la
-- lista. Dejarla colgada de is_accounting la ataba al permiso escrito a mano:
-- el día que se limpie ese permiso, el mostrador se quedaba sin bancos.
alter policy treasury_read on public.treasury_accounts using (private.is_team());

-- ------------------------------------------ RPC ABIERTAS A CUALQUIERA
-- recuperar_reserva_del_carnet devuelve el CÓDIGO DE SEGUIMIENTO, que es la
-- única llave del comprador: con lot_id + carnet cualquiera lo obtenía, sin
-- límite de intentos. Su único llamador es /api/reservas con el cliente de
-- servicio, así que revocarla no rompe nada.
revoke execute on function public.recuperar_reserva_del_carnet(uuid, text) from public, anon, authenticated;

-- depreciacion_del_mes: SECURITY DEFINER sin guardia, ejecutable por PUBLIC.
-- No la llama el front; la usa la trastienda de activos.
revoke execute on function public.depreciacion_del_mes(uuid, integer, integer) from public, anon, authenticated;

-- --------------------------------------------------- v_proyectos y anon
-- Vista de dueño (no security_invoker) con SELECT para anon: un visitante
-- anónimo listaba las SEIS urbanizaciones en borrador con nombre, slug,
-- prefijo, cantidad de lotes y cuántos van vendidos. La lee sólo la pantalla
-- de Urbanizaciones, que es de admin.
alter view public.v_proyectos set (security_invoker = on);
revoke all on public.v_proyectos from anon;
