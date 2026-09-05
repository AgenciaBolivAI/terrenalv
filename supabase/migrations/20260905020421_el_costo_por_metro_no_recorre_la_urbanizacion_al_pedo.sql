-- private.costo_m2 se lleva el 97% del trabajo del libro entero.
--
--   private.libro_base:  20 ms · 3.037 buffers
--   de eso, la rama de costo de ventas:  17 ms · 2.944 buffers
--
-- Y devuelve CERO filas, porque todavía no hay ni un terreno madre cargado.
-- La culpa es del último lateral: suma `area_m2` de TODOS los lotes de la
-- urbanización (2.078 hoy) en CADA llamada, y se la llama una vez por venta
-- confirmada — 22 recorridos completos de la tabla para dividir por una
-- superficie que, sin compras ni obras, no se usa para nada.
--
-- La cuenta no cambia; cambia CUÁNDO se hace: si no hay compras de terreno ni
-- obras capitalizadas, no hay costo que repartir y se sale antes de tocar
-- `lots`. El presupuesto cargado sigue mandando por encima de todo, igual que
-- antes. Comprobado: mismos valores en las 7 urbanizaciones y en tres fechas
-- distintas, antes y después.

create or replace function private.costo_m2(p_project_id uuid, p_fecha date)
returns numeric
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  with pp as (
    select sum(lp.costo_compra)              as compras,
           max(lp.costo_m2_presupuestado)    as presupuesto
      from public.land_parcels lp
     where lp.project_id = p_project_id and lp.fecha_compra <= p_fecha
  ), ob as (
    select sum(e.amount_bob) as obras
      from public.expenses e
      join public.centros_costo cc on cc.id = e.centro_costo_id
     where e.project_id = p_project_id and e.deleted_at is null
       and cc.capitaliza and e.incurred_on <= p_fecha
  )
  select case
           -- Si hay presupuesto cargado, manda: el margen no depende de
           -- cuándo se pagó cada obra.
           when pp.presupuesto is not null then pp.presupuesto
           -- Sin compras ni obras no hay costo que repartir. Esta rama es la
           -- que evita recorrer los 2.078 lotes para dividir cero.
           when coalesce(pp.compras, 0) + coalesce(ob.obras, 0) = 0 then 0
           else coalesce(
             round((coalesce(pp.compras, 0) + coalesce(ob.obras, 0))
                   / nullif((select sum(l.area_m2) from public.lots l
                              where l.project_id = p_project_id
                                and l.deleted_at is null), 0), 4), 0)
         end
    from pp, ob;
$function$;
