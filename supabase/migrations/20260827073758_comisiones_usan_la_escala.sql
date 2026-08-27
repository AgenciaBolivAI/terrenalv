-- v_comisiones pasa a entender tres formas de pactar una comisión:
--   'escala'  → la del documento del Directorio: el % sale de cuántas ventas
--               lleva el asesor y de si vendió al contado o a plazo.
--   'cobrado' → % fijo sobre lo que entró (lo de antes).
--   'precio'  → % fijo sobre el precio (lo de antes).
-- Las ventas viejas conservan lo suyo; nada se recalcula hacia atrás salvo
-- que alguien las pase a escala a propósito.

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
  case when coalesce(r.commission_base,'cobrado') = 'escala'
       then coalesce(es.pct_total, 0)
       else coalesce(r.commission_pct, 0) end     as pct,
  coalesce(r.commission_base, 'cobrado')          as base,
  r.price_agreed                                  as precio,
  cp.capital                                      as cobrado,
  case when coalesce(r.commission_base,'cobrado') = 'escala'
       then coalesce(es.devengado, 0)
       else cp.ganado end                         as ganado,
  coalesce(pg.pagado, 0)                          as pagado,
  greatest(0::numeric,
    case when coalesce(r.commission_base,'cobrado') = 'escala'
         then coalesce(es.devengado, 0)
         else cp.ganado end - coalesce(pg.pagado, 0)) as por_pagar,
  -- Lo que agrega la escala, al final para no mover las columnas de siempre.
  es.modalidad,
  es.ventas_periodo,
  es.comision_total,
  es.tramo_inicial,
  es.tramo_reintegro,
  es.inicial_cumplida,
  es.reintegro_cumplido,
  es.cuotas_pagadas,
  es.cuota_reintegro
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
left join public.v_comisiones_escala es on es.reservation_id = r.id
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

-- La escala pasa a ser una base válida al pactar una regla.
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_guardar_regla_comision';
  if position('if p_base not in (''precio'',''cobrado'') then' in v_def) = 0 then
    raise exception 'PARCHE_BASE_NO_AGARRA';
  end if;
  v_def := replace(v_def,
    'if p_base not in (''precio'',''cobrado'') then',
    'if p_base not in (''precio'',''cobrado'',''escala'') then');
  execute v_def;
end $$;
