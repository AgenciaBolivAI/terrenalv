-- EL CLIENTE NO VEÍA EL LOTE QUE COMPRÓ.
--
-- Las políticas de `projects`, `lots` y `manzanas` muestran lo que está
-- PUBLICADO y en una urbanización ACTIVA — que es lo correcto para el mapa
-- público. Pero la compra de un cliente puede estar en una urbanización en
-- borrador (hoy 5 de las 6 lo están) o sobre un lote ya vendido, y entonces su
-- propia compra desaparecía: `v_cliente_actividad` hace INNER JOIN con
-- projects y lots, así que su panel salía vacío aunque la reserva sí se viera.
--
-- Se agrega el permiso mínimo: cada cliente ve la urbanización, la manzana y
-- el lote DE SUS PROPIAS COMPRAS, sin importar el estado de publicación. Nada
-- más: el resto del inventario le sigue estando vedado igual que a cualquiera.
drop policy if exists projects_customer_read on public.projects;
create policy projects_customer_read on public.projects
  for select to authenticated
  using (exists (select 1 from public.reservations r
                  where r.project_id = projects.id
                    and r.customer_id = (select auth.uid())));

drop policy if exists lots_customer_read on public.lots;
create policy lots_customer_read on public.lots
  for select to authenticated
  using (exists (select 1 from public.reservations r
                  where r.lot_id = lots.id
                    and r.customer_id = (select auth.uid())));

drop policy if exists manzanas_customer_read on public.manzanas;
create policy manzanas_customer_read on public.manzanas
  for select to authenticated
  using (exists (select 1 from public.lots l
                  join public.reservations r on r.lot_id = l.id
                 where l.manzana_id = manzanas.id
                   and r.customer_id = (select auth.uid())));
