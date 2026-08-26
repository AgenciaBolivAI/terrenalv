-- Permisos por persona, sección por sección.
--
-- El dueño decide qué ve y qué toca cada miembro del equipo: «este vendedor
-- solo Lotes y Planes de pago», «esta persona mira Contabilidad pero no la
-- toca». Tres niveles por sección: no | ve | edita. Y la analítica tiene un
-- nivel propio —'propia'— con el que un vendedor ve SUS números, no los de
-- la empresa.
--
-- Reglas de diseño, para que esto no se vuelva una trampa:
--   · Un admin SIEMPRE puede todo. Los permisos no lo tocan: así nadie se
--     deja a sí mismo (ni al último admin) fuera del panel.
--   · Sin permisos guardados, cada rol conserva lo que ve hoy. Restringir es
--     una decisión, no un accidente de la migración.
--   · «ve» se hace cumplir EN LA BASE con triggers de solo-lectura sobre las
--     secciones limpias (lotes, financiamiento, comisiones, urbanizaciones,
--     configuración, mercado, contabilidad). En ventas/reservas/planes/
--     clientes el cobro cruza tablas de varias secciones, así que ahí «ve»
--     rige en la pantalla y el bloqueo duro sigue siendo el del rol.

alter table public.profiles
  add column if not exists permisos jsonb not null default '{}'::jsonb;

-- ---------- el resolutor ----------------------------------------------------
create or replace function private.nivel_de(p_uid uuid, p_seccion text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role public.team_role;
  v_permisos jsonb;
  v_nivel text;
begin
  select role, permisos into v_role, v_permisos
    from public.profiles where id = p_uid and is_active;
  if v_role is null then return 'no'; end if;
  if v_role = 'admin' then
    return case when p_seccion = 'analitica' then 'empresa' else 'edita' end;
  end if;

  v_nivel := v_permisos ->> p_seccion;
  if v_nivel is not null then return v_nivel; end if;

  -- Sin permiso guardado: lo que cada rol ve hoy, ni más ni menos.
  if p_seccion = 'analitica' then
    return case when v_role = 'contabilidad' then 'empresa' else 'propia' end;
  end if;
  if p_seccion in ('mapa','proyectos','equipo','configuracion','auditoria') then
    return 'no';  -- hoy son solo-admin
  end if;
  if p_seccion in ('contabilidad','planes','comisiones','financiamiento') then
    return case when v_role = 'contabilidad' then 'edita' else 'no' end;
  end if;
  return 'edita';  -- panel, reservas, ventas, clientes, notificaciones,
                   -- mi-cuenta, mercado, traspasos, lotes
end;
$$;

revoke all on function private.nivel_de(uuid, text) from public, anon, authenticated;

-- ---------- lo que ve el panel ----------------------------------------------
create or replace function public.mi_acceso()
returns jsonb
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select coalesce(jsonb_object_agg(s.seccion, private.nivel_de(auth.uid(), s.seccion)), '{}'::jsonb)
    from unnest(array[
      'panel','reservas','ventas','clientes','notificaciones','mi-cuenta',
      'contabilidad','planes','comisiones','financiamiento','analitica',
      'mercado','traspasos','lotes','mapa','proyectos','equipo',
      'configuracion','auditoria'
    ]) as s(seccion);
$$;

grant execute on function public.mi_acceso() to authenticated;
revoke execute on function public.mi_acceso() from anon;

-- ---------- guardarlos ------------------------------------------------------
create or replace function public.admin_guardar_permisos(
  p_profile_id uuid,
  p_permisos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_actor uuid;
  v_role public.team_role;
  v_k text;
  v_v text;
  v_antes jsonb;
begin
  v_actor := private.assert_admin();

  select role, permisos into v_role, v_antes
    from public.profiles where id = p_profile_id;
  if v_role is null then raise exception 'EMPLEADO_NO_ENCONTRADO'; end if;
  if v_role = 'admin' then
    raise exception 'ADMIN_NO_SE_RESTRINGE'
      using detail = 'Un administrador siempre puede todo. Cambiale el rol si querés restringirlo.';
  end if;

  for v_k, v_v in select key, value from jsonb_each_text(coalesce(p_permisos, '{}'::jsonb))
  loop
    if v_k not in ('panel','reservas','ventas','clientes','notificaciones','mi-cuenta',
                   'contabilidad','planes','comisiones','financiamiento','analitica',
                   'mercado','traspasos','lotes','mapa','proyectos','equipo',
                   'configuracion','auditoria') then
      raise exception 'SECCION_DESCONOCIDA' using detail = v_k;
    end if;
    if v_k = 'analitica' then
      if v_v not in ('no','propia','empresa') then
        raise exception 'NIVEL_INVALIDO' using detail = format('%s: %s', v_k, v_v);
      end if;
    elsif v_v not in ('no','ve','edita') then
      raise exception 'NIVEL_INVALIDO' using detail = format('%s: %s', v_k, v_v);
    end if;
  end loop;

  update public.profiles
     set permisos = coalesce(p_permisos, '{}'::jsonb), updated_at = now()
   where id = p_profile_id;

  perform private.audit('team', v_actor, null, 'equipo.permisos', null,
    'profile', p_profile_id, jsonb_build_object('antes', v_antes),
    jsonb_build_object('permisos', p_permisos));

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.admin_guardar_permisos(uuid, jsonb) to authenticated;
revoke execute on function public.admin_guardar_permisos(uuid, jsonb) from anon;

-- ---------- el candado de solo-lectura --------------------------------------
create or replace function private.tg_solo_lectura()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  -- Sin sesión (seed, service role, jobs) no hay a quién restringir.
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  if private.nivel_de(auth.uid(), tg_argv[0]) <> 'edita' then
    raise exception 'PERMISO_SOLO_LECTURA'
      using detail = format('tu acceso a %s es de solo lectura', tg_argv[0]);
  end if;
  return coalesce(new, old);
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('lots',               'lotes'),
      ('manzanas',           'lotes'),
      ('pricing_categories', 'lotes'),
      ('financing_tiers',    'financiamiento'),
      ('commission_rules',   'comisiones'),
      ('projects',           'proyectos'),
      ('settings',           'configuracion'),
      ('market_listings',    'mercado'),
      ('expenses',           'contabilidad'),
      ('journal_entries',    'contabilidad'),
      ('treasury_accounts',  'contabilidad'),
      ('chart_of_accounts',  'contabilidad'),
      ('contacts',           'contabilidad'),
      ('fiscal_periods',     'contabilidad')
    ) as t(tabla, seccion)
  loop
    execute format('drop trigger if exists solo_lectura on public.%I', r.tabla);
    execute format(
      'create trigger solo_lectura before insert or update or delete on public.%I
         for each row execute function private.tg_solo_lectura(%L)',
      r.tabla, r.seccion);
  end loop;
end $$;

-- ---------- la analítica de cada vendedor -----------------------------------
create or replace function public.mi_analitica()
returns jsonb
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  with mias as (
    select r.id, r.price_agreed, r.confirmed_at, r.created_at, r.status,
           coalesce(r.commission_pct, 0) as pct,
           coalesce(r.commission_base, 'cobrado') as base
      from public.reservations r
     where r.sold_by = auth.uid()
  ), pagos as (
    select p.reservation_id,
           sum(case when p.purpose = 'reserva' then p.amount_bob
                    when p.purpose in ('cuota','abono') then p.amount_bob - coalesce(p.interest_bob,0)
                    else 0 end) as capital
      from public.payments p
      join mias m on m.id = p.reservation_id
     where p.status = 'aprobado'
     group by 1
  ), comi as (
    select coalesce(sum(e.amount_bob), 0) as pagada
      from public.expenses e
     where e.profile_id = auth.uid()
       and e.category = 'comisiones'::expense_category and e.deleted_at is null
  )
  select jsonb_build_object(
    'ventas',        (select count(*) from mias where status = 'confirmada'),
    'reservas_vivas',(select count(*) from mias where status in ('pendiente_pago','en_verificacion','rechazo_reintento')),
    'valor_vendido', (select coalesce(sum(price_agreed), 0) from mias where status = 'confirmada'),
    'cobrado',       (select coalesce(sum(p.capital), 0) from pagos p
                        join mias m on m.id = p.reservation_id where m.status = 'confirmada'),
    'comision_ganada', (select coalesce(sum(round(
                         case when m.base = 'precio' then m.price_agreed
                              else coalesce(p.capital, 0) end * m.pct / 100, 2)), 0)
                          from mias m left join pagos p on p.reservation_id = m.id
                         where m.status = 'confirmada'),
    'comision_pagada', (select pagada from comi),
    'por_mes', coalesce((
      select jsonb_agg(fila order by mes)
        from (
          select to_char(date_trunc('month', m.confirmed_at at time zone 'America/La_Paz'), 'YYYY-MM') as mes,
                 count(*) as ventas,
                 sum(m.price_agreed) as monto
            from mias m
           where m.status = 'confirmada' and m.confirmed_at is not null
           group by 1
        ) as fila(mes, ventas, monto)
    ), '[]'::jsonb)
  );
$$;

grant execute on function public.mi_analitica() to authenticated;
revoke execute on function public.mi_analitica() from anon;
