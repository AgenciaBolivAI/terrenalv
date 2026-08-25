-- «Mi cuenta»: lo que cada miembro del equipo ve de SÍ MISMO.
--
-- Un vendedor tiene derecho a ver lo suyo sin pedirle permiso a nadie —qué
-- vendió, cuándo, por cuánto, qué comisión le corresponde y qué le pagaron—
-- pero NO a ver el sueldo del de al lado. Por eso esto es una función que
-- filtra por auth.uid() y no una vista que cualquiera del equipo pueda leer
-- entera: la vista v_comisiones sigue siendo para contabilidad.
create or replace function public.mi_cuenta()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare v_uid uuid; v_p public.profiles%rowtype;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'NO_AUTENTICADO'; end if;

  select * into v_p from public.profiles where id = v_uid and is_active;
  if not found then raise exception 'PERFIL_NO_ENCONTRADO'; end if;

  return jsonb_build_object(
    'profile_id', v_p.id,
    'nombre', v_p.full_name,
    'rol', v_p.role::text,
    'resumen', (
      select jsonb_build_object(
        'ventas', coalesce(count(*) filter (where c.estado = 'confirmada'), 0),
        'valor_vendido', coalesce(sum(c.precio), 0),
        'cobrado', coalesce(sum(c.cobrado), 0),
        'ganado', coalesce(sum(c.ganado), 0),
        'pagado', coalesce(sum(c.pagado), 0),
        'por_pagar', coalesce(sum(c.por_pagar), 0))
        from public.v_comisiones c where c.profile_id = v_uid),
    -- Las reservas que tomó y todavía no son venta: su trabajo en curso.
    'reservas_en_curso', (
      select coalesce(count(*), 0) from public.reservations r
       where r.sold_by = v_uid
         and r.status in ('pendiente_pago','en_verificacion','rechazo_reintento')),
    'ventas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'reservation_id', c.reservation_id,
               'tracking_code', c.tracking_code,
               'fecha', c.fecha_venta,
               'proyecto', c.proyecto,
               'manzana', c.manzana,
               'lote', c.lote,
               'comprador', c.comprador,
               'precio', c.precio,
               'cobrado', c.cobrado,
               'pct', c.pct,
               'base', c.base,
               'ganado', c.ganado,
               'pagado', c.pagado,
               'por_pagar', c.por_pagar,
               'estado', c.estado)
             order by c.fecha_venta desc nulls last)
        from public.v_comisiones c where c.profile_id = v_uid), '[]'::jsonb),
    'pagos_recibidos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'fecha', e.incurred_on,
               'monto', e.amount_bob,
               'venta', r.tracking_code,
               'nota', e.note)
             order by e.incurred_on desc)
        from public.expenses e
        left join public.reservations r on r.id = e.reservation_id
       where e.profile_id = v_uid and e.category = 'comisiones' and e.deleted_at is null),
      '[]'::jsonb));
end;
$fn$;

revoke execute on function public.mi_cuenta() from public, anon;
grant execute on function public.mi_cuenta() to authenticated;
