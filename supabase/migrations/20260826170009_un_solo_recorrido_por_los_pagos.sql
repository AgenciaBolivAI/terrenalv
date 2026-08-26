-- Las pantallas leían la misma plata seis veces.
--
-- private.capital_pagado() es SECURITY DEFINER, y Postgres no puede "meter"
-- una función así dentro de la consulta que la llama: cada llamada es una
-- consulta aparte, con su propio recorrido de la tabla de pagos. v_ventas la
-- llamaba CUATRO veces por fila y además recorría los pagos otras dos veces
-- por su cuenta. Seis lecturas para contestar una sola pregunta: cuánto pagó
-- esta persona.
--
-- Acá se contesta una vez. La cuenta es la misma —la seña baja el precio, de
-- la cuota solo baja el capital— pero se hace en el mismo recorrido que ya
-- contaba las cuotas. La función queda intacta para quien la necesite suelta.
--
-- Ojo: v_ventas está confirmada por definición (WHERE status='confirmada'),
-- así que la seña siempre cuenta, igual que en la función.

create or replace view public.v_ventas as
select
  r.project_id,
  r.id                                                        as reservation_id,
  r.tracking_code,
  r.buyer_full_name,
  r.buyer_ci,
  r.buyer_phone,
  r.buyer_email,
  (r.confirmed_at at time zone 'America/La_Paz')::date         as fecha_venta,
  r.price_agreed,
  r.currency,
  m.code                                                      as manzana,
  l.number                                                    as lote,
  p.name                                                      as proyecto,
  r.client_meta ? 'migrado_de'                                as migrada,
  ((r.client_meta -> 'reportado') ->> 'deuda')::numeric       as deuda_migrada,
  pg.capital                                                  as cobrado_aqui,
  coalesce(pg.cuotas, 0::bigint)                              as pagos_cuota,
  coalesce(pg.abonos, 0::bigint)                              as pagos_abono,
  greatest(0::numeric,
    coalesce(((r.client_meta -> 'reportado') ->> 'deuda')::numeric, r.price_agreed)
    - pg.capital)                                             as saldo,
  exists (select 1 from public.installment_plans ip
           where ip.reservation_id = r.id and ip.status = 'activo')  as con_plan,
  pg.ultimo_pago,
  r.client_meta ? 'migrado_de'
    or r.client_meta ? 'traspaso'
    or coalesce(((r.client_meta -> 'reportado') ->> 'abonado')::numeric, 0) > 0
    or pg.capital > 0                                         as compra_iniciada,
  coalesce(((r.client_meta -> 'reportado') ->> 'abonado')::numeric, 0) as abonado_migrado,
  coalesce(((r.client_meta -> 'reportado') ->> 'abonado')::numeric, 0)
    + pg.capital                                              as pagado_total,
  r.source,
  og.o                                                        as origen,
  private.etiqueta_origen(og.o)                               as origen_label,
  r.client_meta ? 'origen'                                    as origen_declarado,
  coalesce(pg.sena_total, 0)                                  as sena_pagada,
  pg.sena_fecha                                               as sena_fecha,
  coalesce(pg.sena_forma, '')                                 as sena_forma,
  r.client_meta ? 'traspaso'                                  as traspaso,
  (r.client_meta -> 'traspaso') ->> 'de_tracking'             as traspaso_de_tracking,
  (r.client_meta -> 'traspaso') ->> 'de_comprador'            as traspaso_de_comprador,
  ((r.client_meta -> 'traspaso') ->> 'pagado_arrastrado')::numeric as traspaso_pagado,
  (r.client_meta -> 'traspasada_a') ->> 'tracking'            as traspasada_a_tracking,
  ml.id is not null                                           as en_mercado,
  ml.id                                                       as mercado_listing_id,
  ml.asking_price_bob                                         as mercado_pide,
  ml.fee_pct                                                  as mercado_fee_pct,
  coalesce(pg.intereses, 0)                                   as intereses_pagados
from public.reservations r
join public.projects p on p.id = r.project_id
left join public.lots l on l.id = r.lot_id
left join public.manzanas m on m.id = l.manzana_id
-- Un solo recorrido de los pagos: capital, conteos, intereses y seña.
left join lateral (
  select
    coalesce(sum(
      case
        when x.purpose = 'reserva'            then x.amount_bob
        when x.purpose in ('cuota','abono')   then x.amount_bob - coalesce(x.interest_bob, 0)
        else 0
      end), 0)                                                          as capital,
    count(*) filter (where x.purpose = 'cuota')                         as cuotas,
    count(*) filter (where x.purpose = 'abono')                         as abonos,
    sum(x.interest_bob) filter (where x.purpose in ('cuota','abono'))   as intereses,
    max((x.verified_at at time zone 'America/La_Paz')::date)
      filter (where x.purpose in ('cuota','abono'))                     as ultimo_pago,
    sum(x.amount_bob) filter (where x.purpose = 'reserva')              as sena_total,
    max((x.verified_at at time zone 'America/La_Paz')::date)
      filter (where x.purpose = 'reserva')                              as sena_fecha,
    max(private.forma_de_pago(x.provider))
      filter (where x.purpose = 'reserva')                              as sena_forma
  from public.payments x
  where x.reservation_id = r.id and x.status = 'aprobado'
) pg on true
-- El origen se calcula una vez y se usa dos: cruda y con su etiqueta.
cross join lateral (
  select private.origen_de_venta(r.source, r.client_meta, r.created_at, r.confirmed_at) as o
) og
left join public.market_listings ml
       on ml.reservation_id = r.id and ml.status in ('activa','pausada')
where r.status = 'confirmada';

-- create or replace view se come el security_invoker en silencio. Ya me pasó
-- una vez con v_libro_diario: la vista sigue andando pero deja de respetar el
-- RLS de quien pregunta. Se vuelve a poner, siempre.
alter view public.v_ventas set (security_invoker = true);
