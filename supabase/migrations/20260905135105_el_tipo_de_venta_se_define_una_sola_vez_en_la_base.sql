-- El CASE de traspaso → crédito → contado → sin plan estaba escrito en
-- `rep_ventas_por_tipo` y lo acabo de copiar a la ficha de Cuentas. Dos copias
-- es una que se olvida de actualizar: el día que cambien las reglas, el tablero
-- y Cuentas dirían cosas distintas de la misma venta. Una sola función, y las
-- dos la llaman. (En el front sigue estando en `ventas/tipo-venta.ts`, con el
-- comentario que avisa que son espejo.)

create or replace function private.tipo_de_venta(
  p_traspaso boolean, p_con_plan boolean, p_saldo numeric
) returns text
language sql immutable
as $function$
  select case
           when coalesce(p_traspaso, false) then 'Traspaso'
           when coalesce(p_con_plan, false) then 'Crédito'
           when coalesce(p_saldo, 0) <= 0   then 'Contado'
           else 'Sin plan'
         end;
$function$;

-- El orden en que la contadora los quiere leer.
create or replace function private.orden_de_tipo(p_tipo text)
returns integer
language sql immutable
as $function$
  select case p_tipo
           when 'Contado'  then 1
           when 'Crédito'  then 2
           when 'Traspaso' then 3
           else 4
         end;
$function$;

create or replace function public.rep_ventas_por_tipo(
  p_project_id uuid default null::uuid,
  p_desde date default null::date,
  p_hasta date default null::date
)
returns table(tipo text, orden integer, ventas integer, valor numeric, cobrado numeric, saldo numeric)
language sql
stable
set search_path to 'public', 'private', 'extensions'
as $function$
  with t as (
    select private.tipo_de_venta(traspaso, con_plan, saldo) as tipo,
           price_agreed, pagado_total, saldo
      from public.v_ventas
     where compra_iniciada
       and (p_project_id is null or project_id = p_project_id)
       and (p_desde is null or fecha_venta >= p_desde)
       and (p_hasta is null or fecha_venta <= p_hasta)
  )
  select tipo,
         private.orden_de_tipo(tipo) as orden,
         count(*)::int,
         round(sum(price_agreed), 2),
         round(sum(pagado_total), 2),
         round(sum(saldo), 2)
    from t
   group by tipo
   order by 2;
$function$;

-- Los movimientos del cliente SIN un solo importe, con la modalidad ya
-- resuelta. Es lo que lee la pantalla de Cuentas: no puede mostrar plata
-- porque no la recibe.
create or replace view public.v_cliente_actividad_ficha
with (security_invoker = on) as
  select a.ci_norm,
         a.reservation_id,
         a.tracking_code,
         a.estado,
         a.proyecto,
         a.manzana,
         a.lote,
         a.area_m2,
         a.created_at,
         a.fecha_confirmada,
         a.fecha_cancelada,
         a.cancel_reason,
         a.origen_label,
         a.recibida_por_traspaso,
         a.cedida_por_traspaso,
         a.cedida_a_tracking,
         a.cedida_a_comprador,
         a.traspaso_de_tracking,
         a.traspaso_de_comprador,
         case when a.estado = 'confirmada'
              then private.tipo_de_venta(a.recibida_por_traspaso, a.con_plan, a.saldo)
         end as modalidad,
         coalesce(a.fecha_confirmada,
                  (a.created_at at time zone 'America/La_Paz')::date) as fecha
    from public.v_cliente_actividad a;

grant select on public.v_cliente_actividad_ficha to authenticated;

-- Y la ficha usa la misma función que el tablero.
create or replace view public.v_clientes_ficha
with (security_invoker = on) as
with compras as (
  select a.ci_norm, a.modalidad, a.fecha
    from public.v_cliente_actividad_ficha a
   where a.estado = 'confirmada'
)
select c.ci_norm,
       c.buyer_full_name,
       c.buyer_ci,
       c.buyer_phone,
       c.buyer_email,
       c.lotes_comprados,
       c.reservas_totales,
       c.lotes_reservados,
       c.proyectos,
       c.primera_actividad,
       c.ultima_actividad,
       c.nombres_distintos,
       c.nombres_vistos,
       cp.direccion,
       cp.referencias,
       cp.ubicacion,
       cp.nota,
       cu.id           as customer_id,
       cu.city,
       cu.birth_date,
       cu.como_nos_conocio,
       coalesce(cu.marketing_opt_in, false) as marketing_opt_in,
       cu.email_verificado_at is not null   as correo_verificado,
       (cu.created_at at time zone 'America/La_Paz')::date as fecha_registro,
       m.modalidades,
       m.primera_compra,
       m.ultima_compra
  from public.v_clientes c
  left join public.client_profiles cp on cp.ci_normalized = c.ci_norm
  left join public.customers      cu on cu.ci_normalized = c.ci_norm
  left join lateral (
       select string_agg(distinct k.modalidad, ' · ' order by k.modalidad) as modalidades,
              min(k.fecha) as primera_compra,
              max(k.fecha) as ultima_compra
         from compras k
        where k.ci_norm = c.ci_norm
  ) m on true;

grant select on public.v_clientes_ficha to authenticated;
