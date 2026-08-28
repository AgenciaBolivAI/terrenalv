-- CUIDADO CON `is_accounting`: NO es «la contabilidad».
--
-- Su nombre engaña. Cuarenta y nueve RPC la exigen, y la mayoría son del
-- MOSTRADOR, no del libro: `admin_confirmar_reserva`,
-- `admin_register_cuota_payment`, `admin_editar_venta`, `admin_traspasar_venta`,
-- `admin_comision_a_escala`… Es «puede operar la trastienda», no «es
-- contable». Por eso Beymar tiene `contabilidad:edita` guardado: fue la forma
-- de dejarlo cobrar y confirmar ventas.
--
-- Si le ato `is_accounting` al techo del rol, el vendedor deja de poder vender.
-- Ya pasó una vez y no vuelve a pasar. Así que vuelve como estaba.
create or replace function private.is_accounting()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active
      and (p.role in ('admin', 'contabilidad')
           or p.permisos->>'contabilidad' = 'edita')
  );
$$;

comment on function private.is_accounting is
  'MAL NOMBRE, se conserva por la cantidad de RPC que la nombran: es «puede '
  'operar la trastienda» (confirmar reservas, cobrar cuotas, editar ventas), '
  'no «es del área contable». Para lo que es del LIBRO está '
  'private.assert_contabilidad(), que sí mira el techo del rol.';

-- La puerta estricta, para lo que sí es del libro y nada más.
create or replace function private.assert_contabilidad()
returns uuid
language plpgsql
stable
set search_path to 'public', 'private'
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return auth.uid();  -- trabajos internos y clave de servicio
  end if;
  if private.nivel_de((select auth.uid()), 'contabilidad') <> 'edita' then
    raise exception 'NO_AUTORIZADO'
      using detail = 'La contabilidad es de Contabilidad y de Administración.';
  end if;
  return auth.uid();
end;
$$;

grant execute on function private.assert_contabilidad() to authenticated;

-- Y se la ponemos a lo que es del libro y solo del libro: los asientos
-- manuales, los egresos, el plan de cuentas, la tesorería y el cierre de
-- gestión. Nada de esto lo toca un vendedor: vive entero dentro de la
-- pantalla de Contabilidad, que ya no le aparece.
do $$
declare v_nombre text; v_def text; v_arg text;
begin
  foreach v_nombre in array array[
    'admin_save_voucher', 'admin_void_voucher',
    'admin_record_expense', 'admin_delete_expense',
    'admin_upsert_account', 'admin_delete_account',
    'admin_guardar_concepto_egreso', 'admin_borrar_concepto_egreso',
    'admin_guardar_centro_costo', 'admin_borrar_centro_costo',
    'admin_upsert_treasury', 'admin_transfer_funds',
    'admin_set_ufv', 'admin_post_reexpresion'
  ] loop
    for v_def, v_arg in
      select pg_get_functiondef(p.oid), pg_get_function_identity_arguments(p.oid)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_nombre and p.prokind = 'f'
    loop
      if position('private.assert_accounting()' in v_def) = 0 then
        raise exception 'PARCHE_NO_AGARRA'
          using detail = format('%s(%s) ya no pide assert_accounting.', v_nombre, v_arg);
      end if;
      execute replace(v_def, 'private.assert_accounting()', 'private.assert_contabilidad()');
    end loop;
  end loop;
end $$;
