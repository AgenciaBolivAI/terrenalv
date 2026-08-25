-- Mercado de traspasos: el comprador ofrece su lote, otro se interesa, y la
-- oficina ejecuta el traspaso.
--
-- Terrenalv es dueña del lote hasta que se paga entero, así que acá NADIE se
-- transfiere nada solo: el mercado publica y conecta, y el traspaso se firma
-- en la oficina con el módulo que ya existe — con su arrastre, su auditoría y
-- sus libros. El mercado es la vidriera; el mostrador sigue siendo el mostrador.
--
-- Privacidad: la vidriera pública muestra el LOTE (proyecto, manzana, número,
-- superficie, precio pedido, saldo que el interesado asumiría) y JAMÁS al
-- vendedor. El interesado deja su contacto; el vendedor lo ve en SU página de
-- seguimiento (la llave es su código, el mismo secreto de siempre) y la
-- oficina lo ve todo.

create table if not exists public.market_listings (
  id             uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  asking_price_bob numeric(14,2) not null check (asking_price_bob > 0),
  note           text,
  status         text not null default 'activa' check (status in ('activa','pausada','cerrada')),
  closed_reason  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Una sola publicación viva por venta: dos avisos del mismo lote con precios
-- distintos son una pelea esperando a pasar.
create unique index if not exists market_listings_activa_uidx
  on public.market_listings (reservation_id) where status in ('activa','pausada');

create table if not exists public.market_inquiries (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references public.market_listings (id) on delete cascade,
  nombre      text not null check (btrim(nombre) <> ''),
  telefono    text not null check (btrim(telefono) <> ''),
  mensaje     text,
  atendida    boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists market_inquiries_listing on public.market_inquiries (listing_id, created_at desc);

alter table public.market_listings enable row level security;
alter table public.market_inquiries enable row level security;
revoke all on public.market_listings, public.market_inquiries from anon, authenticated;

-- El equipo lee todo; el público pasa por la vista y los RPC.
grant select on public.market_listings, public.market_inquiries to authenticated;
create policy mercado_equipo_lee on public.market_listings
  for select to authenticated using (private.is_team());
create policy consultas_equipo_lee on public.market_inquiries
  for select to authenticated using (private.is_team());

create trigger set_updated_at before update on public.market_listings
  for each row execute function private.tg_set_updated_at();

-- ---- La vidriera pública. SIN security_invoker: corre como dueña para poder
--      leer las tablas, y expone SOLO columnas del lote — el vendedor no
--      aparece ni por accidente.
create or replace view public.v_mercado as
select ml.id as listing_id,
       pr.name as proyecto,
       pr.slug,
       m.code as manzana,
       l.number as lote,
       l.area_m2,
       r.price_agreed as precio_lote,
       v.saldo as saldo_a_asumir,
       ml.asking_price_bob,
       ml.note,
       (ml.created_at at time zone 'America/La_Paz')::date as publicada
  from public.market_listings ml
  join public.reservations r on r.id = ml.reservation_id
  join public.projects pr on pr.id = r.project_id
  join public.v_ventas v on v.reservation_id = r.id
  left join public.lots l on l.id = r.lot_id
  left join public.manzanas m on m.id = l.manzana_id
 where ml.status = 'activa' and r.status = 'confirmada';

grant select on public.v_mercado to anon, authenticated;

-- ---- Publicar / retirar, con el código de seguimiento como llave.
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
begin
  if p_asking is null or p_asking <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  select * into v_res from public.reservations
   where tracking_code = upper(btrim(coalesce(p_tracking_code, '')));
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  -- Solo una COMPRA se ofrece: una reserva sin confirmar no es de nadie
  -- todavía, y una cancelada ya no existe.
  if v_res.status <> 'confirmada' then raise exception 'NO_ES_VENTA'; end if;

  -- Si ya tenía publicación (activa o pausada), se actualiza y reactiva.
  update public.market_listings
     set asking_price_bob = round(p_asking, 2),
         note = nullif(btrim(coalesce(p_note, '')), ''),
         status = 'activa', closed_reason = null, updated_at = now()
   where reservation_id = v_res.id and status in ('activa','pausada')
  returning id into v_id;

  if v_id is null then
    insert into public.market_listings (reservation_id, asking_price_bob, note)
    values (v_res.id, round(p_asking, 2), nullif(btrim(coalesce(p_note, '')), ''))
    returning id into v_id;
  end if;

  perform private.audit('guest', null, null, 'mercado.publicado', v_res.project_id,
    'market_listing', v_id, null,
    jsonb_build_object('tracking', v_res.tracking_code, 'pide', p_asking));

  return jsonb_build_object('listing_id', v_id);
end;
$fn$;

create or replace function public.mercado_retirar(p_tracking_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare v_res public.reservations%rowtype; v_n int;
begin
  select * into v_res from public.reservations
   where tracking_code = upper(btrim(coalesce(p_tracking_code, '')));
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;

  update public.market_listings
     set status = 'cerrada', closed_reason = 'retirada por el vendedor', updated_at = now()
   where reservation_id = v_res.id and status in ('activa','pausada');
  get diagnostics v_n = row_count;

  return jsonb_build_object('cerradas', v_n);
end;
$fn$;

-- ---- El interesado deja su contacto. Con un freno de abuso simple: más de 50
--      consultas en un día sobre el mismo aviso no es interés, es un script.
create or replace function public.mercado_consultar(
  p_listing_id uuid, p_nombre text, p_telefono text, p_mensaje text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare v_ml public.market_listings%rowtype; v_tel text; v_id uuid;
begin
  if btrim(coalesce(p_nombre, '')) = '' then raise exception 'NAME_REQUIRED'; end if;
  v_tel := private.normalize_phone_bo(p_telefono);
  if coalesce(v_tel, '') = '' then raise exception 'BUYER_PHONE_REQUIRED'; end if;

  select * into v_ml from public.market_listings where id = p_listing_id and status = 'activa';
  if not found then raise exception 'LISTING_NOT_FOUND'; end if;

  if (select count(*) from public.market_inquiries
       where listing_id = p_listing_id and created_at > now() - interval '1 day') >= 50 then
    raise exception 'DEMASIADAS_CONSULTAS';
  end if;

  insert into public.market_inquiries (listing_id, nombre, telefono, mensaje)
  values (p_listing_id, btrim(p_nombre), v_tel, nullif(btrim(coalesce(p_mensaje, '')), ''))
  returning id into v_id;

  return jsonb_build_object('inquiry_id', v_id);
end;
$fn$;

-- ---- El vendedor ve SUS consultas con su código.
create or replace function public.mercado_mis_consultas(p_tracking_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare v_res public.reservations%rowtype;
begin
  select * into v_res from public.reservations
   where tracking_code = upper(btrim(coalesce(p_tracking_code, '')));
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'nombre', i.nombre, 'telefono', i.telefono, 'mensaje', i.mensaje,
             'fecha', (i.created_at at time zone 'America/La_Paz')::date)
           order by i.created_at desc)
      from public.market_inquiries i
      join public.market_listings ml on ml.id = i.listing_id
     where ml.reservation_id = v_res.id), '[]'::jsonb);
end;
$fn$;

-- El estado de la publicación de una venta, para su página de seguimiento.
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
    'estado', v_ml.status,
    'consultas', (select count(*) from public.market_inquiries where listing_id = v_ml.id));
end;
$fn$;

revoke execute on function
  public.mercado_publicar(text, numeric, text),
  public.mercado_retirar(text),
  public.mercado_consultar(uuid, text, text, text),
  public.mercado_mis_consultas(text),
  public.mercado_mi_publicacion(text)
from public;
grant execute on function
  public.mercado_publicar(text, numeric, text),
  public.mercado_retirar(text),
  public.mercado_consultar(uuid, text, text, text),
  public.mercado_mis_consultas(text),
  public.mercado_mi_publicacion(text)
to anon, authenticated, service_role;

-- ---- El traspaso cierra la publicación solo: el lote ya cambió de manos.
create or replace function private.cerrar_publicacion_por_traspaso(p_reservation_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.market_listings
     set status = 'cerrada', closed_reason = 'traspaso ejecutado', updated_at = now()
   where reservation_id = p_reservation_id and status in ('activa','pausada');
$$;

grant execute on function private.cerrar_publicacion_por_traspaso(uuid)
  to authenticated, service_role;

-- La vista de la oficina: publicación + vendedor + consultas.
create or replace view public.v_mercado_admin
with (security_invoker = true) as
select ml.id as listing_id,
       ml.status,
       ml.asking_price_bob,
       ml.note,
       (ml.created_at at time zone 'America/La_Paz')::date as publicada,
       r.id as reservation_id,
       r.tracking_code,
       r.buyer_full_name,
       r.buyer_phone,
       pr.name as proyecto,
       m.code as manzana,
       l.number as lote,
       v.saldo,
       (select count(*) from public.market_inquiries i where i.listing_id = ml.id) as consultas,
       (select count(*) from public.market_inquiries i
         where i.listing_id = ml.id and not i.atendida) as consultas_sin_atender
  from public.market_listings ml
  join public.reservations r on r.id = ml.reservation_id
  join public.projects pr on pr.id = r.project_id
  left join public.v_ventas v on v.reservation_id = r.id
  left join public.lots l on l.id = r.lot_id
  left join public.manzanas m on m.id = l.manzana_id;

grant select on public.v_mercado_admin to authenticated;
