-- Los precios de lote se redondean a bolivianos enteros.
--
-- price_per_m2 tiene dos decimales, y multiplicado por áreas como 244,03 m²
-- daba precios como Bs 36.878,73. Nadie vende un terreno con centavos: el
-- vendedor dice una cifra redonda, el cartel dice otra, y el comprador
-- desconfía de la diferencia.
--
-- Redondear acá y no en la aplicación es a propósito: el mapa, la página de
-- reserva, el plan de cuotas, los recibos y la contabilidad leen todos esta
-- función, así que hacerlo en un solo lado dejaría los demás con la cifra
-- larga. Un precio manual (price_override) se respeta tal cual: si alguien
-- escribió 24.750,50 es porque quiso.
create or replace function public.lot_price(p_lot_id uuid)
returns numeric
language sql
stable
set search_path to 'public', 'extensions'
as $fn$
  select coalesce(l.price_override, round(pc.price_per_m2 * l.area_m2, 0))
  from public.lots l
  left join public.pricing_categories pc on pc.id = l.category_id
  where l.id = p_lot_id;
$fn$;
