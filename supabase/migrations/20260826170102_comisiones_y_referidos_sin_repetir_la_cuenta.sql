-- Mismo arreglo en las otras dos vistas que preguntaban lo mismo varias veces.
--
-- En ambas, el WHERE ya exige 'confirmada' o traspasada — que es exactamente
-- la condición con la que la función cuenta la seña. Así que acá la seña
-- siempre suma, y la cuenta inline da idéntico resultado que la función.

create or replace view public.v_comisiones as
select
  r.id                                            as reservation_id,
  r.project_id,
  pr.name                                         as proyecto,
  r.tracking_code,
  r.status::text                                  as estado,
  (r.confirmed_at at time zone 'America/La_Paz')::date as fecha_venta,
  m.code                                          as manzana,
  l.number                                        as lote,
  r.buyer_full_name                               as comprador,
  r.sold_by                                       as profile_id,
  p.full_name                                     as vendedor,
  p.role::text                                    as vendedor_rol,
  coalesce(r.commission_pct, 0)                   as pct,
  coalesce(r.commission_base, 'cobrado')          as base,
  r.price_agreed                                  as precio,
  cp.capital                                      as cobrado,
  cp.ganado                                       as ganado,
  coalesce(pg.pagado, 0)                          as pagado,
  greatest(0::numeric, cp.ganado - coalesce(pg.pagado, 0)) as por_pagar
from public.reservations r
join public.projects pr on pr.id = r.project_id
left join public.profiles p on p.id = r.sold_by
left join public.lots l on l.id = r.lot_id
left join public.manzanas m on m.id = l.manzana_id
cross join lateral (
  select cap.capital,
         round(case when coalesce(r.commission_base,'cobrado') = 'precio'
                    then r.price_agreed else cap.capital end
               * coalesce(r.commission_pct, 0) / 100, 2) as ganado
    from (
      select coalesce(sum(
               case
                 when x.purpose = 'reserva'          then x.amount_bob
                 when x.purpose in ('cuota','abono') then x.amount_bob - coalesce(x.interest_bob,0)
                 else 0
               end), 0) as capital
        from public.payments x
       where x.reservation_id = r.id and x.status = 'aprobado'
    ) cap
) cp
left join lateral (
  select sum(e.amount_bob) as pagado
    from public.expenses e
   where e.reservation_id = r.id
     and e.category = 'comisiones'::expense_category
     and e.deleted_at is null
) pg on true
where r.sold_by is not null
  and (r.status = 'confirmada' or r.client_meta ? 'traspasada_a');

alter view public.v_comisiones set (security_invoker = true);


create or replace view public.v_referidos_movimientos as
 select r.id as movimiento_id, 'reserva'::text as tipo,
        coalesce(r.confirmed_at, r.created_at) as cuando,
        r.project_id, pr.name as proyecto, r.sold_by as profile_id,
        p.full_name as empleado, p.role::text as rol,
        r.id as reservation_id, r.tracking_code, m.code as manzana, l.number as lote,
        r.buyer_full_name as comprador, r.price_agreed as monto,
        0::numeric as comision, r.status::text as estado, null::text as nota
   from public.reservations r
   join public.projects pr on pr.id = r.project_id
   join public.profiles p on p.id = r.sold_by
   left join public.lots l on l.id = r.lot_id
   left join public.manzanas m on m.id = l.manzana_id
  where r.sold_by is not null
    and r.status in ('pendiente_pago','en_verificacion','rechazo_reintento','expirada')
union all
 select r.id, 'venta'::text, r.confirmed_at,
        r.project_id, pr.name, r.sold_by, p.full_name, p.role::text,
        r.id, r.tracking_code, m.code, l.number,
        r.buyer_full_name, r.price_agreed,
        round(case when coalesce(r.commission_base,'cobrado') = 'precio'
                   then r.price_agreed else cap.capital end
              * coalesce(r.commission_pct, 0) / 100, 2),
        r.status::text,
        (coalesce(r.commission_pct,0) || '% sobre ') || coalesce(r.commission_base,'cobrado')
   from public.reservations r
   join public.projects pr on pr.id = r.project_id
   join public.profiles p on p.id = r.sold_by
   left join public.lots l on l.id = r.lot_id
   left join public.manzanas m on m.id = l.manzana_id
   cross join lateral (
     select coalesce(sum(
              case
                when x.purpose = 'reserva'          then x.amount_bob
                when x.purpose in ('cuota','abono') then x.amount_bob - coalesce(x.interest_bob,0)
                else 0
              end), 0) as capital
       from public.payments x
      where x.reservation_id = r.id and x.status = 'aprobado'
   ) cap
  where r.sold_by is not null
    and (r.status = 'confirmada' or r.client_meta ? 'traspasada_a')
union all
 select e.id, 'pago_comision'::text, e.incurred_on::timestamptz,
        e.project_id, pr.name, e.profile_id, p.full_name, p.role::text,
        e.reservation_id, r.tracking_code, m.code, l.number,
        r.buyer_full_name, e.amount_bob, e.amount_bob, 'pagado'::text, e.note
   from public.expenses e
   join public.profiles p on p.id = e.profile_id
   join public.projects pr on pr.id = e.project_id
   left join public.reservations r on r.id = e.reservation_id
   left join public.lots l on l.id = r.lot_id
   left join public.manzanas m on m.id = l.manzana_id
  where e.category = 'comisiones'::expense_category
    and e.deleted_at is null and e.profile_id is not null;

alter view public.v_referidos_movimientos set (security_invoker = true);
