-- El vendedor se anota AL VENDER, no después: si queda para más tarde, nadie
-- se acuerda de quién cerró la venta de hace tres semanas y la comisión se
-- discute a memoria.
do $patch$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='mark_sold_offline';
  if position('p_sold_by' in v_def) > 0 then return; end if;

  -- Firma nueva con el vendedor al final.
  v_def := replace(v_def,
    'p_plan_interes_mensual numeric DEFAULT NULL::numeric)',
    'p_plan_interes_mensual numeric DEFAULT NULL::numeric, p_sold_by uuid DEFAULT NULL::uuid)');
  -- Guardar vendedor y congelar su comisión.
  v_def := replace(v_def,
    $$  update public.lots set active_reservation_id = v_res_id where id = v_lot.id;$$,
    $$  update public.lots set active_reservation_id = v_res_id where id = v_lot.id;

  -- El vendedor y su comisión, congelada con la regla vigente hoy.
  if p_sold_by is not null then
    perform public.admin_asignar_vendedor(v_res_id, p_sold_by);
  end if;$$);
  if position('p_sold_by' in v_def) = 0 then
    raise exception 'PATCH_NO_APLICADO: mark_sold_offline';
  end if;
  execute v_def;
end;
$patch$;

grant execute on function public.mark_sold_offline(
  uuid, text, text, text, text, numeric, text, public.payment_provider_kind,
  text, char, numeric, uuid, numeric, int, numeric, date, numeric, uuid)
  to authenticated, service_role;

-- Lo mismo al reservar de mostrador.
do $patch2$
declare v_def text; v_args text;
begin
  select pg_get_functiondef(p.oid), pg_get_function_identity_arguments(p.oid)
    into v_def, v_args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='admin_reserve_offline';
  if v_def is null or position('p_sold_by' in v_def) > 0 then return; end if;
  raise notice 'admin_reserve_offline args: %', v_args;
end;
$patch2$;

-- El equipo, para el selector de vendedor (nombre y rol, nada más).
create or replace view public.v_equipo_activo
with (security_invoker = true) as
select p.id, p.full_name, p.role::text as rol
  from public.profiles p
 where p.is_active;

grant select on public.v_equipo_activo to authenticated;
