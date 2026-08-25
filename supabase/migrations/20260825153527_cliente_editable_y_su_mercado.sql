-- El cliente se edita como PERSONA y su perfil cuenta TODO, mercado incluido.
--
-- Hasta ahora el teléfono se corregía venta por venta: si Fulano tiene tres
-- lotes, había que editar tres ventas y rezar que nadie olvidara una. Ahora el
-- perfil edita a la persona: un cambio vale para todas sus reservas, que es
-- donde vive desnormalizado el comprador (no hay tabla de clientes a propósito
-- — la llave es el carnet normalizado).
--
-- Y el perfil gana su vida en el mercado: qué publicó, qué vendió, a quién,
-- por cuánto y qué comisión pagó.

-- ---- 1. Editar al cliente entero.
create or replace function public.admin_editar_cliente(
  p_ci_norm text,
  p_full_name text default null,
  p_ci text default null,
  p_phone text default null,
  p_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid;
  v_antes record;
  v_ci_nuevo text;
  v_tel text;
  v_correo text;
  v_merge boolean := false;
  v_n int;
begin
  v_actor := private.assert_accounting();

  if coalesce(btrim(p_ci_norm), '') = '' then raise exception 'CLIENT_NOT_FOUND'; end if;

  -- La foto de antes: su reserva más reciente — la misma regla con la que el
  -- perfil muestra nombre y contacto.
  select buyer_full_name, buyer_ci, buyer_phone, buyer_email into v_antes
    from public.reservations
   where buyer_ci_normalized = p_ci_norm
   order by created_at desc limit 1;
  if not found then raise exception 'CLIENT_NOT_FOUND'; end if;

  if p_full_name is not null and btrim(p_full_name) = '' then
    raise exception 'BUYER_NAME_REQUIRED';
  end if;

  -- Cambiar el CI cambia la LLAVE del cliente. Si el carnet nuevo ya es de
  -- otro cliente, esto los FUSIONA en uno — es lo correcto cuando la misma
  -- persona quedó partida en dos por un carnet mal tipeado, y queda dicho en
  -- la auditoría y en la respuesta para que la oficina lo vea.
  if p_ci is not null then
    v_ci_nuevo := private.normalize_ci(p_ci);
    if coalesce(v_ci_nuevo, '') = '' then raise exception 'BUYER_CI_REQUIRED'; end if;
    if v_ci_nuevo <> p_ci_norm then
      v_merge := exists (select 1 from public.reservations
                          where buyer_ci_normalized = v_ci_nuevo);
    end if;
  end if;

  if p_phone is not null then
    v_tel := private.normalize_phone_bo(p_phone);
    if coalesce(v_tel, '') = '' then raise exception 'BUYER_PHONE_REQUIRED'; end if;
  end if;

  -- Correo: null no toca; vacío lo borra (las migradas no traían); con
  -- contenido, se valida como siempre.
  if p_email is not null and btrim(p_email) <> '' then
    v_correo := private.exigir_correo(p_email);
  end if;

  update public.reservations
     set buyer_full_name = coalesce(btrim(p_full_name), buyer_full_name),
         buyer_ci = coalesce(btrim(p_ci), buyer_ci),
         buyer_ci_normalized = coalesce(v_ci_nuevo, buyer_ci_normalized),
         buyer_phone = coalesce(v_tel, buyer_phone),
         buyer_email = case when p_email is null then buyer_email
                            else v_correo end,
         updated_at = now()
   where buyer_ci_normalized = p_ci_norm;
  get diagnostics v_n = row_count;

  perform private.audit('team', v_actor, null, 'cliente.editado', null,
    'cliente', null,
    jsonb_build_object('ci_norm', p_ci_norm, 'nombre', v_antes.buyer_full_name,
                       'ci', v_antes.buyer_ci, 'tel', v_antes.buyer_phone,
                       'correo', v_antes.buyer_email),
    jsonb_build_object('nombre', p_full_name, 'ci', p_ci, 'tel', p_phone,
                       'correo', p_email, 'reservas', v_n, 'fusionado', v_merge));

  return jsonb_build_object(
    'reservas_actualizadas', v_n,
    'ci_norm', coalesce(v_ci_nuevo, p_ci_norm),
    'fusionado', v_merge);
end;
$fn$;

revoke execute on function public.admin_editar_cliente(text, text, text, text, text)
  from public, anon;
grant execute on function public.admin_editar_cliente(text, text, text, text, text)
  to authenticated, service_role;

-- ---- 2. Su vida en el mercado, aviso por aviso.
create or replace view public.v_cliente_mercado
with (security_invoker = true) as
select r.buyer_ci_normalized as ci_norm,
       ml.id as listing_id,
       ml.status,
       ml.asking_price_bob,
       ml.note,
       (ml.created_at at time zone 'America/La_Paz')::date as publicada,
       ml.closed_reason,
       ml.sale_price_bob,
       ml.fee_pct,
       ml.fee_bob,
       ml.fee_payment_id,
       r.tracking_code,
       pr.name as proyecto,
       m.code as manzana,
       l.number as lote,
       (select count(*) from public.market_inquiries i where i.listing_id = ml.id) as consultas,
       r.client_meta->'traspasada_a'->>'tracking' as vendido_a_tracking,
       r.client_meta->'traspasada_a'->>'comprador' as vendido_a
  from public.market_listings ml
  join public.reservations r on r.id = ml.reservation_id
  join public.projects pr on pr.id = r.project_id
  left join public.lots l on l.id = r.lot_id
  left join public.manzanas m on m.id = l.manzana_id
 where coalesce(r.buyer_ci_normalized, '') <> '';

grant select on public.v_cliente_mercado to authenticated;

-- ---- 3. v_clientes suma su mercado (columnas nuevas al final).
create or replace view public.v_clientes
with (security_invoker = true) as
with base as (
  select r.buyer_ci_normalized as ci_norm,
         r.id, r.status, r.created_at, r.confirmed_at, r.client_meta,
         r.buyer_full_name, r.buyer_ci, r.buyer_phone, r.buyer_email, r.project_id
    from public.reservations r
   where coalesce(r.buyer_ci_normalized, '') <> ''
),
ultimo as (
  select distinct on (ci_norm)
         ci_norm, buyer_full_name, buyer_ci, buyer_phone, buyer_email
    from base
   order by ci_norm, created_at desc
)
select u.ci_norm,
       u.buyer_full_name,
       u.buyer_ci,
       u.buyer_phone,
       u.buyer_email,
       count(*) as reservas_totales,
       count(*) filter (where b.status = 'confirmada') as lotes_comprados,
       count(*) filter (where b.status in ('pendiente_pago','en_verificacion','rechazo_reintento'))
         as lotes_reservados,
       count(*) filter (where b.status = 'expirada') as reservas_expiradas,
       count(*) filter (where b.status = 'cancelada') as reservas_canceladas,
       count(*) filter (where b.status = 'cancelada' and b.client_meta ? 'traspasada_a')
         as traspasos_cedidos,
       count(*) filter (where b.status = 'confirmada' and b.client_meta ? 'traspaso')
         as traspasos_recibidos,
       count(distinct b.project_id) as proyectos,
       coalesce(pg.pagado_directo, 0)
         + coalesce(mig.abonado, 0) as pagado_total,
       coalesce(vv.saldo, 0) as saldo_total,
       coalesce(vv.con_plan, 0) as con_plan,
       coalesce(pl.cuotas_vencidas, 0) as cuotas_vencidas,
       coalesce(pl.monto_vencido, 0) as monto_vencido,
       min(b.created_at) as primera_actividad,
       greatest(max(b.created_at), max(pg.ultimo_pago)) as ultima_actividad,
       coalesce(pg.comisiones, 0) as comisiones_pagadas,
       coalesce(mk.avisos, 0) as avisos_mercado,
       coalesce(mk.activos, 0) as avisos_activos,
       coalesce(mk.vendidos, 0) as vendidos_mercado,
       coalesce(mk.vendido_bob, 0) as vendido_mercado_bob
  from ultimo u
  join base b on b.ci_norm = u.ci_norm
  left join lateral (
    -- Lo que nos pagó por sus LOTES (señas incluidas: esa plata entró igual).
    -- La comisión del mercado va aparte: es un servicio, no paga terreno.
    select sum(p.amount_bob) filter (where p.purpose <> 'comision') as pagado_directo,
           sum(p.amount_bob) filter (where p.purpose = 'comision') as comisiones,
           max(p.verified_at) as ultimo_pago
      from public.payments p
      join base b2 on b2.id = p.reservation_id
     where b2.ci_norm = u.ci_norm and p.status = 'aprobado'
  ) pg on true
  left join lateral (
    select sum((b2.client_meta->'reportado'->>'abonado')::numeric) as abonado
      from base b2
     where b2.ci_norm = u.ci_norm and b2.status = 'confirmada'
       and b2.client_meta ? 'reportado'
  ) mig on true
  left join lateral (
    select sum(v.saldo) as saldo, count(*) filter (where v.con_plan) as con_plan
      from public.v_ventas v
      join base b2 on b2.id = v.reservation_id
     where b2.ci_norm = u.ci_norm
  ) vv on true
  left join lateral (
    select sum(p.cuotas_vencidas) as cuotas_vencidas, sum(p.monto_vencido) as monto_vencido
      from public.v_planes p
     where private.normalize_ci(p.buyer_ci) = u.ci_norm and p.estado = 'activo'
  ) pl on true
  left join lateral (
    select count(*) as avisos,
           count(*) filter (where ml.status = 'activa') as activos,
           count(*) filter (where ml.fee_payment_id is not null) as vendidos,
           sum(ml.sale_price_bob) filter (where ml.fee_payment_id is not null) as vendido_bob
      from public.market_listings ml
      join base b2 on b2.id = ml.reservation_id
     where b2.ci_norm = u.ci_norm
  ) mk on true
 group by u.ci_norm, u.buyer_full_name, u.buyer_ci, u.buyer_phone, u.buyer_email,
          pg.pagado_directo, pg.comisiones, mig.abonado, vv.saldo, vv.con_plan,
          pl.cuotas_vencidas, pl.monto_vencido, pg.ultimo_pago,
          mk.avisos, mk.activos, mk.vendidos, mk.vendido_bob;

grant select on public.v_clientes to authenticated;

-- ---- 4. La actividad dice cuándo el mercado estuvo de por medio.
create or replace view public.v_cliente_actividad
with (security_invoker = true) as
select r.buyer_ci_normalized as ci_norm,
       r.id as reservation_id,
       r.tracking_code,
       r.status::text as estado,
       pr.name as proyecto,
       m.code as manzana,
       l.number as lote,
       r.price_agreed,
       r.created_at,
       (r.confirmed_at at time zone 'America/La_Paz')::date as fecha_confirmada,
       (r.cancelled_at at time zone 'America/La_Paz')::date as fecha_cancelada,
       r.cancel_reason,
       (r.client_meta ? 'traspaso') as recibida_por_traspaso,
       (r.client_meta ? 'traspasada_a') as cedida_por_traspaso,
       r.client_meta->'traspasada_a'->>'tracking' as cedida_a_tracking,
       private.etiqueta_origen(
         private.origen_de_venta(r.source, r.client_meta, r.created_at, r.confirmed_at)
       ) as origen_label,
       v.pagado_total,
       v.saldo,
       v.con_plan,
       (r.client_meta->'traspaso' ? 'mercado') as comprada_en_mercado,
       (r.client_meta->'traspaso'->'mercado'->>'precio')::numeric as precio_mercado,
       exists (select 1 from public.market_listings ml
                where ml.reservation_id = r.id and ml.fee_payment_id is not null)
         as vendida_en_mercado
  from public.reservations r
  join public.projects pr on pr.id = r.project_id
  left join public.lots l on l.id = r.lot_id
  left join public.manzanas m on m.id = l.manzana_id
  left join public.v_ventas v on v.reservation_id = r.id
 where coalesce(r.buyer_ci_normalized, '') <> '';

grant select on public.v_cliente_actividad to authenticated;
