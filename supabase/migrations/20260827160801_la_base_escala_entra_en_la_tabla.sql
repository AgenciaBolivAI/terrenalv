-- El check de reservations.commission_base solo conocía 'precio' y
-- 'cobrado': cuando la escala pasó a ser el default (al apagar la regla
-- general vieja), TODA venta nueva moría contra la restricción. Apareció
-- probando como Beymar, una operación antes de que le pasara al equipo.
alter table public.reservations drop constraint if exists reservations_commission_base_check;
alter table public.reservations add constraint reservations_commission_base_check
  check (commission_base is null or commission_base in ('precio','cobrado','escala'));
