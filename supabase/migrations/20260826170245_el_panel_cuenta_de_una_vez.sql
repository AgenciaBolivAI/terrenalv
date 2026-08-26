-- La primera pantalla del día hacía diez preguntas para llenar diez casillas:
-- una por cada estado de lote y de reserva. Diez viajes al servidor para algo
-- que la base contesta agrupando, en dos.
--
-- El panel es lo primero que abre todo el mundo a la mañana; que tarde ahí se
-- siente más que en cualquier otro lado.

create or replace view public.v_conteo_lotes as
select project_id, status::text as status, count(*) as n
  from public.lots
 where deleted_at is null
 group by project_id, status;

alter view public.v_conteo_lotes set (security_invoker = true);

create or replace view public.v_conteo_reservas as
select project_id, status::text as status, count(*) as n
  from public.reservations
 group by project_id, status;

alter view public.v_conteo_reservas set (security_invoker = true);

-- Contar lotes por estado dentro de un proyecto es de las cosas que más se
-- pregunta: el panel, el mapa, la pantalla de lotes.
create index if not exists lots_proyecto_estado_idx
  on public.lots(project_id, status)
  where deleted_at is null;
