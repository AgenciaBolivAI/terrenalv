-- LA VIDRIERA ESTABA VACÍA PARA TODO EL QUE NO FUERA DEL EQUIPO.
--
-- Al corregir cómo cotiza la deuda le puse a v_mercado `security_invoker = true`
-- por costumbre. Fue un error: esta vista es una VIDRIERA PÚBLICA. Con invoker,
-- la consulta corre con los permisos del visitante y choca contra la RLS de
-- market_listings, que solo deja leer al equipo — así que un anónimo recibía
-- «permission denied for table market_listings» y /mercado se veía vacío para
-- todo el mundo.
--
-- Vuelve a correr con los permisos del dueño, que es lo correcto acá: la vista
-- YA elige qué se muestra, y lo que muestra es seguro — listing_id, proyecto,
-- manzana, lote, superficie, precio, saldo a asumir, nota y comisión. Ni el
-- nombre, ni el teléfono, ni el carnet del vendedor salen de esta vista.
--
-- La regla, para no repetirlo: `security_invoker` es para las vistas que deben
-- respetar la RLS de quien mira (las del panel). Una vista pensada para
-- mostrarle algo a un desconocido tiene que correr como su dueño, y por eso
-- elige columna por columna lo que expone.
alter view public.v_mercado set (security_invoker = false);
grant select on public.v_mercado to anon, authenticated;
