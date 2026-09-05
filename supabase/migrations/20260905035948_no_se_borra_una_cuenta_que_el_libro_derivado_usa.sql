-- `admin_delete_account` contaba los movimientos así:
--
--     select count(*) from public.journal_lines where account_code = p_code;
--
-- pero `journal_lines` es UNA de las 25 ramas del libro: la de los comprobantes
-- manuales. Las otras 24 son derivadas —la venta, el cobro, el interés, el
-- egreso, el activo, el fondo, la planilla— y no dejan una sola fila ahí. Así
-- que la cuenta se veía «sin movimientos» y se BORRABA de verdad.
--
-- Comprobado en vivo, tres cuentas con saldo real y cero líneas manuales:
--
--   4311        Intereses de Financiamiento          Bs   -406,67
--   4211        Comisiones del Mercado de Traspasos  Bs -5.400,00
--   2.01.04.010 Proveedores por Pagar                 2 movimientos
--
-- Borrar cualquiera de ellas deja al libro apuntando a una cuenta que ya no
-- existe: el join contra el plan pierde la fila y los estados dejan de cuadrar,
-- sin un error que lo cante.
--
-- Ahora se mira el libro ENTERO (private.libro_base, que incluye la rama
-- manual), se mira si alguna función la lleva escrita a mano —una cuenta puede
-- no tener movimientos hoy y ser el destino fijo de una rama— y se mira que no
-- tenga hijas. Con cualquiera de las tres, se desactiva en vez de borrar.

create or replace function public.admin_delete_account(p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $function$
declare
  v_actor uuid;
  v_acc public.chart_of_accounts%rowtype;
  v_usos int;
  v_hijas int;
  v_codeada int;
  v_motivo text;
begin
  v_actor := private.assert_contabilidad();
  select * into v_acc from public.chart_of_accounts where code = p_code;
  if v_acc.code is null then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if v_acc.is_system then raise exception 'CUENTA_DE_SISTEMA'; end if;

  -- 1) El libro COMPLETO, no sólo los comprobantes manuales.
  select count(*) into v_usos from private.libro_base where cuenta = p_code;

  -- 2) Cuentas con hijas: borrarlas parte el árbol del plan.
  select count(*) into v_hijas from public.chart_of_accounts where parent_code = p_code;

  -- 3) Escrita a mano en alguna función: hoy puede no tener movimientos y ser
  --    el destino fijo de una rama del libro o de un RPC. Ante la duda, no se
  --    borra.
  select count(*) into v_codeada
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public','private') and p.prokind = 'f'
     and p.proname <> 'admin_delete_account'
     and position('''' || p_code || '''' in pg_get_functiondef(p.oid)) > 0;

  if v_usos > 0 or v_hijas > 0 or v_codeada > 0 then
    v_motivo := concat_ws(', ',
      nullif(format('%s movimiento(s) en el libro', v_usos), '0 movimiento(s) en el libro'),
      case when v_hijas > 0 then format('%s cuenta(s) hija(s)', v_hijas) end,
      case when v_codeada > 0 then format('la usan %s función(es) del sistema', v_codeada) end);

    update public.chart_of_accounts set is_active = false, updated_at = now() where code = p_code;
    perform private.audit('team', v_actor, null, 'account.deactivated', null, 'account', null,
      null, jsonb_build_object('codigo', p_code, 'movimientos', v_usos,
                               'hijas', v_hijas, 'en_funciones', v_codeada));
    return jsonb_build_object('ok', true, 'desactivada', true,
                              'movimientos', v_usos, 'motivo', v_motivo);
  end if;

  delete from public.chart_of_accounts where code = p_code;
  perform private.audit('team', v_actor, null, 'account.deleted', null, 'account', null,
    jsonb_build_object('codigo', p_code, 'nombre', v_acc.name), null);
  return jsonb_build_object('ok', true, 'desactivada', false);
end;
$function$;

-- Guardián: toda cuenta que el libro usa tiene que existir y estar activa. Es
-- el invariante que hacía falta para que un borrado así no pase inadvertido.
create or replace function private.cuentas_del_libro_que_no_existen()
returns table(cuenta text, movimientos bigint, motivo text)
language sql
stable
set search_path to 'public', 'private'
as $$
  select b.cuenta, count(*),
         case when c.code is null then 'no existe en el plan' else 'está inactiva' end
    from private.libro_base b
    left join public.chart_of_accounts c on c.code = b.cuenta
   where c.code is null or not c.is_active
   group by b.cuenta, c.code
$$;

do $$
declare
  v_def text;
  v_ancla text := $ancla$  select count(*) into v_n from private.meses_depreciados_dos_veces();
  return query select 'ningun_mes_depreciado_dos_veces'::text, (v_n = 0),
    format('%s mes(es) con la depreciación asentada más de una vez', v_n);$ancla$;
begin
  v_def := pg_get_functiondef('public.verificar_integridad()'::regprocedure);
  if position(v_ancla in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA: falta el ancla de depreciación';
  end if;
  execute replace(v_def, v_ancla, v_ancla || $nuevo$

  -- El libro no puede asentar en una cuenta borrada ni desactivada.
  select count(*) into v_n from private.cuentas_del_libro_que_no_existen();
  return query select 'toda_cuenta_del_libro_existe_y_esta_activa'::text, (v_n = 0),
    format('%s cuenta(s) usadas por el libro que no existen o están inactivas', v_n);$nuevo$);
end $$;
