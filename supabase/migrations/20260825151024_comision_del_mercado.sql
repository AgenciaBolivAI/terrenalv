-- Comisión del mercado de traspasos: vender POR el mercado paga a la oficina
-- un porcentaje del precio de venta (20% por defecto); un traspaso normal —
-- sin publicación de por medio — no paga nada.
--
-- La comisión es un PAGO de verdad (purpose 'comision'): entra por caja o QR,
-- tiene recibo para el vendedor, y se asienta como ingreso propio (4211), no
-- como plata del lote. Por eso todo lo que suma pagos del lote aprende a
-- ignorarla: el saldo del comprador no baja porque el vendedor pagó comisión.

-- ---- 1. La cuenta de ingreso.
insert into public.chart_of_accounts (code, name, kind)
select '4211', 'Comisiones del Mercado de Traspasos', 'ingreso'
 where not exists (select 1 from public.chart_of_accounts where code = '4211');

-- ---- 2. El propósito nuevo.
alter table public.payments drop constraint if exists payments_purpose_check;
alter table public.payments add constraint payments_purpose_check
  check (purpose in ('reserva','cuota','abono','comision'));

-- ---- 3. La publicación conoce su comisión y recuerda cómo terminó.
alter table public.market_listings
  add column if not exists fee_pct numeric(5,2) not null default 20
    check (fee_pct >= 0 and fee_pct <= 100),
  add column if not exists sale_price_bob numeric(14,2),
  add column if not exists fee_bob numeric(14,2),
  add column if not exists fee_payment_id uuid references public.payments (id);

-- El porcentaje por defecto vive en settings: la oficina lo cambia sin tocar código.
insert into public.settings (project_id, key, value, is_public)
select null, 'mercado_fee_pct', '20'::jsonb, true
 where not exists (select 1 from public.settings where key = 'mercado_fee_pct' and project_id is null);

-- ---- 4. Publicar toma el porcentaje vigente (solo para avisos nuevos:
--         el de uno existente pudo haberse pactado y no se pisa).
create or replace function public.mercado_publicar(
  p_tracking_code text, p_asking numeric, p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_res public.reservations%rowtype;
  v_id uuid;
  v_pct numeric;
begin
  if p_asking is null or p_asking <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  select * into v_res from public.reservations
   where tracking_code = upper(btrim(coalesce(p_tracking_code, '')));
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if v_res.status <> 'confirmada' then raise exception 'NO_ES_VENTA'; end if;

  update public.market_listings
     set asking_price_bob = round(p_asking, 2),
         note = nullif(btrim(coalesce(p_note, '')), ''),
         status = 'activa', closed_reason = null, updated_at = now()
   where reservation_id = v_res.id and status in ('activa','pausada')
  returning id into v_id;

  if v_id is null then
    v_pct := coalesce((select (value#>>'{}')::numeric from public.settings
                        where key = 'mercado_fee_pct' and project_id is null), 20);
    insert into public.market_listings (reservation_id, asking_price_bob, note, fee_pct)
    values (v_res.id, round(p_asking, 2), nullif(btrim(coalesce(p_note, '')), ''), v_pct)
    returning id into v_id;
  end if;

  perform private.audit('guest', null, null, 'mercado.publicado', v_res.project_id,
    'market_listing', v_id, null,
    jsonb_build_object('tracking', v_res.tracking_code, 'pide', p_asking));

  return jsonb_build_object('listing_id', v_id);
end;
$fn$;

-- El vendedor ve el porcentaje en su página: nadie descubre la comisión al final.
create or replace function public.mercado_mi_publicacion(p_tracking_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare v_res public.reservations%rowtype; v_ml public.market_listings%rowtype;
begin
  select * into v_res from public.reservations
   where tracking_code = upper(btrim(coalesce(p_tracking_code, '')));
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;

  select * into v_ml from public.market_listings
   where reservation_id = v_res.id and status in ('activa','pausada')
   order by created_at desc limit 1;
  if not found then return null; end if;

  return jsonb_build_object(
    'listing_id', v_ml.id, 'pide', v_ml.asking_price_bob, 'nota', v_ml.note,
    'estado', v_ml.status, 'comision_pct', v_ml.fee_pct,
    'consultas', (select count(*) from public.market_inquiries where listing_id = v_ml.id));
end;
$fn$;

-- ---- 5. La vidriera muestra el porcentaje, y su saldo ignora comisiones.
create or replace view public.v_mercado as
select ml.id as listing_id,
       pr.name as proyecto,
       pr.slug,
       m.code as manzana,
       l.number as lote,
       l.area_m2,
       r.price_agreed as precio_lote,
       greatest(0, coalesce((r.client_meta->'reportado'->>'deuda')::numeric, r.price_agreed)
                   - coalesce(pg.total, 0)) as saldo_a_asumir,
       ml.asking_price_bob,
       ml.note,
       (ml.created_at at time zone 'America/La_Paz')::date as publicada,
       ml.fee_pct
  from public.market_listings ml
  join public.reservations r on r.id = ml.reservation_id
  join public.projects pr on pr.id = r.project_id
  left join public.lots l on l.id = r.lot_id
  left join public.manzanas m on m.id = l.manzana_id
  left join lateral (
    select sum(x.amount_bob) as total
      from public.payments x
     where x.reservation_id = r.id and x.status = 'aprobado'
       and x.purpose in ('cuota','abono')
  ) pg on true
 where ml.status = 'activa' and r.status = 'confirmada';

grant select on public.v_mercado to anon, authenticated;

-- ---- 6. v_ventas: solo cuotas y abonos pagan el lote; y expone si la venta
--         está publicada en el mercado (columnas nuevas al final).
create or replace view public.v_ventas
with (security_invoker = true) as
select r.project_id,
       r.id as reservation_id,
       r.tracking_code,
       r.buyer_full_name,
       r.buyer_ci,
       r.buyer_phone,
       r.buyer_email,
       (r.confirmed_at at time zone 'America/La_Paz')::date as fecha_venta,
       r.price_agreed,
       r.currency,
       m.code as manzana,
       l.number as lote,
       p.name as proyecto,
       (r.client_meta ? 'migrado_de') as migrada,
       coalesce((r.client_meta->'reportado'->>'deuda')::numeric, null) as deuda_migrada,
       coalesce(pg.total, 0) as cobrado_aqui,
       coalesce(pg.cuotas, 0) as pagos_cuota,
       coalesce(pg.abonos, 0) as pagos_abono,
       greatest(0, coalesce((r.client_meta->'reportado'->>'deuda')::numeric, r.price_agreed)
                   - coalesce(pg.total, 0)) as saldo,
       exists (select 1 from public.installment_plans ip
                where ip.reservation_id = r.id and ip.status = 'activo') as con_plan,
       pg.ultimo_pago,
       ((r.client_meta ? 'migrado_de')
        or (r.client_meta ? 'traspaso')
        or coalesce((r.client_meta->'reportado'->>'abonado')::numeric, 0) > 0
        or coalesce(pg.total, 0) > 0) as compra_iniciada,
       coalesce((r.client_meta->'reportado'->>'abonado')::numeric, 0) as abonado_migrado,
       coalesce((r.client_meta->'reportado'->>'abonado')::numeric, 0) + coalesce(pg.total, 0)
         as pagado_total,
       r.source,
       private.origen_de_venta(r.source, r.client_meta, r.created_at, r.confirmed_at) as origen,
       private.etiqueta_origen(
         private.origen_de_venta(r.source, r.client_meta, r.created_at, r.confirmed_at)
       ) as origen_label,
       (r.client_meta ? 'origen') as origen_declarado,
       coalesce(sn.total, 0) as sena_pagada,
       sn.fecha as sena_fecha,
       coalesce(sn.forma, '') as sena_forma,
       (r.client_meta ? 'traspaso') as traspaso,
       r.client_meta->'traspaso'->>'de_tracking' as traspaso_de_tracking,
       r.client_meta->'traspaso'->>'de_comprador' as traspaso_de_comprador,
       (r.client_meta->'traspaso'->>'pagado_arrastrado')::numeric as traspaso_pagado,
       r.client_meta->'traspasada_a'->>'tracking' as traspasada_a_tracking,
       (ml.id is not null) as en_mercado,
       ml.id as mercado_listing_id,
       ml.asking_price_bob as mercado_pide,
       ml.fee_pct as mercado_fee_pct
  from public.reservations r
  join public.projects p on p.id = r.project_id
  left join public.lots l on l.id = r.lot_id
  left join public.manzanas m on m.id = l.manzana_id
  left join lateral (
    select sum(x.amount_bob) as total,
           count(*) filter (where x.purpose = 'cuota') as cuotas,
           count(*) filter (where x.purpose = 'abono') as abonos,
           max((x.verified_at at time zone 'America/La_Paz')::date) as ultimo_pago
      from public.payments x
     where x.reservation_id = r.id and x.status = 'aprobado'
       and x.purpose in ('cuota','abono')
  ) pg on true
  left join lateral (
    select sum(x.amount_bob) as total,
           max((x.verified_at at time zone 'America/La_Paz')::date) as fecha,
           max(private.forma_de_pago(x.provider)) as forma
      from public.payments x
     where x.reservation_id = r.id and x.status = 'aprobado' and x.purpose = 'reserva'
  ) sn on true
  left join public.market_listings ml
    on ml.reservation_id = r.id and ml.status in ('activa','pausada')
 where r.status = 'confirmada';

grant select on public.v_ventas to authenticated;
