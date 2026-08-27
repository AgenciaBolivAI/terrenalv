-- PLAN DE CUENTAS COMPLETO — lo que trae el plan de Las Lomas (CONTAB) y el
-- nuestro no tenía:
--
--   · JERARQUÍA LIBRE: rubro → grupo → subgrupo → cuenta imputable, con
--     códigos como 1.02.01.010. El código es texto: cualquier formato entra.
--   · MONEDA POR CUENTA (Bs / $us), como la columna «Moneda» del PDF.
--   · CENTRO DE COSTOS S/N por cuenta, como la columna «C.Costo»: en cuáles
--     tiene sentido pedir el centro al asentar.
--   · LA REGLA DE ORO de CONTAB: una cuenta con hijas es TITULAR — agrupa,
--     no se asienta. Los asientos van SOLO a cuentas hoja. Hasta hoy se
--     podía asentar en 1111 teniendo 1111.01 y 1111.02: el mayor de 1111
--     mezclaba lo directo con lo de sus hijas y no cuadraba contra nada.

alter table public.chart_of_accounts
  add column if not exists moneda char(3) not null default 'BOB',
  add column if not exists usa_centro_costo boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chart_moneda_check') then
    alter table public.chart_of_accounts add constraint chart_moneda_check
      check (moneda in ('BOB','USD'));
  end if;
end $$;

comment on column public.chart_of_accounts.moneda is
  'La moneda de la cuenta, como la columna Moneda del plan CONTAB. El libro '
  'sigue siendo en Bs; esto documenta y prepara el bimonetario.';
comment on column public.chart_of_accounts.usa_centro_costo is
  'S/N del plan CONTAB: si al asentar en esta cuenta corresponde indicar '
  'centro de costos (típicamente gastos e ingresos, no balances).';

-- Los gastos e ingresos existentes usan centro de costos, como el PDF (S en
-- todo el 4xxx y 5xxx salvo redondeo).
update public.chart_of_accounts set usa_centro_costo = true
 where kind in ('ingreso','gasto') and not usa_centro_costo;

-- ---------- alta/edición con lo nuevo, una sola firma ----------------------
drop function if exists public.admin_upsert_account(text, text, text, integer, text, boolean);

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_upsert_account';
  if v_def is not null then
    raise exception 'QUEDO_OTRA_FIRMA_VIVA';
  end if;
exception when no_data_found then null;
end $$;

create or replace function public.admin_upsert_account(
  p_code text,
  p_name text,
  p_kind text,
  p_sort_order integer default null,
  p_parent_code text default null,
  p_is_active boolean default true,
  p_moneda text default 'BOB',
  p_usa_centro_costo boolean default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_actor uuid;
  v_kind text;
  v_existente public.chart_of_accounts%rowtype;
begin
  v_actor := private.assert_accounting();
  if btrim(coalesce(p_code, '')) = '' then raise exception 'CODIGO_REQUERIDO'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'NOMBRE_REQUERIDO'; end if;
  if coalesce(p_moneda,'BOB') not in ('BOB','USD') then raise exception 'MONEDA_INVALIDA'; end if;

  -- La naturaleza: la elegida, o la del padre — una hija no puede ser de
  -- otra naturaleza que su titular (un gasto colgando del activo es un
  -- balance que no cierra nunca).
  if p_parent_code is not null then
    select kind::text into v_kind from public.chart_of_accounts where code = p_parent_code;
    if v_kind is null then raise exception 'PADRE_NO_ENCONTRADO'; end if;
    if p_kind is not null and p_kind <> v_kind then
      raise exception 'NATURALEZA_DISTINTA_AL_PADRE'
        using detail = format('El padre %s es de naturaleza %s.', p_parent_code, v_kind);
    end if;
  else
    v_kind := p_kind;
  end if;
  if v_kind is null then raise exception 'NATURALEZA_REQUERIDA'; end if;

  select * into v_existente from public.chart_of_accounts where code = btrim(p_code);

  if v_existente.code is null then
    insert into public.chart_of_accounts
      (code, name, kind, sort_order, parent_code, is_active, is_system, moneda, usa_centro_costo)
    values (btrim(p_code), btrim(p_name), v_kind::account_kind,
            coalesce(p_sort_order, 0), p_parent_code, coalesce(p_is_active, true), false,
            coalesce(p_moneda,'BOB'),
            coalesce(p_usa_centro_costo, v_kind in ('ingreso','gasto')));
  else
    -- Una cuenta del sistema conserva código y naturaleza: el libro
    -- automático la nombra por su código.
    if v_existente.is_system and p_kind is not null and p_kind <> v_existente.kind::text then
      raise exception 'CUENTA_DE_SISTEMA'
        using detail = 'A una cuenta del sistema se le cambia el nombre, no la naturaleza.';
    end if;
    update public.chart_of_accounts
       set name = btrim(p_name),
           sort_order = coalesce(p_sort_order, sort_order),
           parent_code = coalesce(p_parent_code, parent_code),
           is_active = coalesce(p_is_active, is_active),
           moneda = coalesce(p_moneda, moneda),
           usa_centro_costo = coalesce(p_usa_centro_costo, usa_centro_costo),
           updated_at = now()
     where code = v_existente.code;
  end if;

  perform private.audit('team', v_actor, null, 'cuenta.guardada', null,
    'account', null, null,
    jsonb_build_object('codigo', p_code, 'nombre', p_name, 'naturaleza', v_kind,
                       'padre', p_parent_code, 'moneda', p_moneda));
  return jsonb_build_object('code', btrim(p_code));
end;
$$;

grant execute on function public.admin_upsert_account(text, text, text, integer, text, boolean, text, boolean) to authenticated;
revoke execute on function public.admin_upsert_account(text, text, text, integer, text, boolean, text, boolean) from anon;

-- ---------- la regla de oro: solo cuentas hoja se asientan ------------------
do $$
declare v_def text; v_ancla text; v_freno text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_save_voucher';

  v_ancla := 'if (v_line->>''account_code'') in
       (''1131'',''2131'',''4111'',''4211'',''4311'',''4411'',''1151'',''5121'') then';
  if position(v_ancla in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA';
  end if;

  v_freno := 'if exists (select 1 from public.chart_of_accounts h
                where h.parent_code = v_line->>''account_code'' and h.is_active) then
      raise exception ''CUENTA_TITULAR''
        using detail = format(''La cuenta %s tiene cuentas hijas: es una titular, agrupa pero no se asienta. Asentá en una de sus hijas.'', v_line->>''account_code'');
    end if;
    ' || v_ancla;

  v_def := replace(v_def, v_ancla, v_freno);
  execute v_def;
end $$;

-- Y una vista del plan con su jerarquía resuelta, para la pantalla y el PDF
-- con la pinta del listado CONTAB.
create or replace view public.v_plan_de_cuentas as
with recursive arbol as (
  select c.code, c.name, c.kind::text as kind, c.parent_code, c.is_active,
         c.is_system, c.moneda, c.usa_centro_costo, c.sort_order,
         0 as nivel, c.code::text as camino
    from public.chart_of_accounts c
   where c.parent_code is null
  union all
  select c.code, c.name, c.kind::text, c.parent_code, c.is_active,
         c.is_system, c.moneda, c.usa_centro_costo, c.sort_order,
         a.nivel + 1, a.camino || '>' || c.code
    from public.chart_of_accounts c
    join arbol a on a.code = c.parent_code
)
select a.*,
       not exists (select 1 from public.chart_of_accounts h
                    where h.parent_code = a.code and h.is_active) as imputable
  from arbol a;

alter view public.v_plan_de_cuentas set (security_invoker = true);
