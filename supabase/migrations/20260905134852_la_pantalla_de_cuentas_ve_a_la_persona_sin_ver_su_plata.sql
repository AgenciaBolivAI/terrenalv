-- Cuentas tiene que mostrar a la MISMA gente que Clientes —la ficha de la
-- persona— pero sin un solo importe. Lo único que se dice de la compra es
-- cómo la pagó y cuándo: «Contado, 12/03/2026». Ni precio, ni pagado, ni saldo.
--
-- La plata no se esconde en la pantalla: no se selecciona acá. Lo que el
-- navegador nunca recibe no se puede filtrar por mirar el inspector.
--
-- El CASE de la modalidad es el MISMO y en el MISMO orden que
-- `src/features/admin/ventas/tipo-venta.ts` y que `rep_ventas_por_tipo`:
-- traspaso → crédito → contado → sin plan. Un traspaso pagado del todo es
-- traspaso, no contado. Si se cambia en un lado se cambia en los tres.
create or replace view public.v_clientes_ficha
with (security_invoker = on) as
with compras as (
  select a.ci_norm,
         case
           when a.recibida_por_traspaso then 'Traspaso'
           when coalesce(a.con_plan, false) then 'Crédito'
           when coalesce(a.saldo, 0) <= 0 then 'Contado'
           else 'Sin plan'
         end as modalidad,
         coalesce(a.fecha_confirmada, (a.created_at at time zone 'America/La_Paz')::date) as fecha
    from public.v_cliente_actividad a
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
       -- La ficha que carga la oficina.
       cp.direccion,
       cp.referencias,
       cp.ubicacion,
       cp.nota,
       -- Lo que sabemos si además se creó una cuenta en la web.
       cu.id           as customer_id,
       cu.city,
       cu.birth_date,
       cu.como_nos_conocio,
       coalesce(cu.marketing_opt_in, false) as marketing_opt_in,
       cu.email_verificado_at is not null   as correo_verificado,
       (cu.created_at at time zone 'America/La_Paz')::date as fecha_registro,
       -- Cómo compró y cuándo. Sin valores.
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
