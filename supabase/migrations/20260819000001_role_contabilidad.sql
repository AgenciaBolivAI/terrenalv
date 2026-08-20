-- Un tercer rol: contabilidad.
--
-- Hasta ahora solo había admin y ventas, así que para que alguien pudiera
-- cobrar cuotas, cargar egresos y emitir recibos había que hacerlo admin — y
-- con eso quedaba pudiendo invitar gente, cambiar precios y reescribir la
-- configuración del proyecto. Un contador no necesita nada de eso.
--
-- El valor del enum va en su propia migración: Postgres no deja usar un valor
-- nuevo de enum en la misma transacción que lo crea.
alter type public.team_role add value if not exists 'contabilidad';
