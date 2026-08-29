-- EL SUELDO ES DEL MES QUE SE TRABAJÓ.
--
-- Hasta hoy la planilla no tocaba los libros hasta que se pagaba: si el sueldo
-- de agosto se pagaba el 3 de septiembre, agosto cerraba sin ese gasto y
-- septiembre lo llevaba doble. Eso es contabilidad de caja, y un resultado
-- mensual armado así no sirve para decidir nada.
--
-- Ahora la planilla tiene dos momentos:
--
--   DEVENGAR (fin de mes)  gasto de sueldos  /  2.01.07.010 SUELDOS POR PAGAR
--   PAGAR                  2.01.07.010       /  la caja o el banco
--
-- El devengado se registra como un egreso por persona con forma de pago
-- «planilla», así que el sueldo sigue estando donde siempre estuvo —en los
-- egresos, en la analítica por categoría y en el margen por urbanización— y
-- además queda debiéndose hasta que se paga. El pago usa la misma máquina que
-- el pago a proveedores, con lo que también puede ser parcial (un adelanto a
-- mitad de mes y el resto después).

alter table public.hr_planillas
  add column if not exists devengada_el date;

alter table public.hr_planillas drop constraint if exists hr_planillas_estado_check;
alter table public.hr_planillas add constraint hr_planillas_estado_check
  check (estado in ('borrador','devengada','pagada'));

comment on column public.hr_planillas.devengada_el is
  'El día con el que entra al libro el gasto de sueldos. Normalmente el último '
  'del mes trabajado, no el día que se paga.';

-- ---------------------------------------------------------------------------
-- Devengar: el gasto entra al mes trabajado y queda debiéndose.
-- ---------------------------------------------------------------------------
create or replace function public.admin_devengar_planilla(
  p_planilla_id uuid, p_fecha date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_actor uuid; v_pl public.hr_planillas%rowtype; r record;
  v_res jsonb; v_total numeric(14,2) := 0; v_n int := 0;
  v_proj uuid; v_concepto uuid; v_fecha date;
begin
  v_actor := private.assert_seccion('rrhh');
  select * into v_pl from public.hr_planillas where id = p_planilla_id for update;
  if not found then raise exception 'PLANILLA_NO_ENCONTRADA'; end if;
  if v_pl.estado <> 'borrador' then
    raise exception 'PLANILLA_YA_DEVENGADA'
      using detail = 'Esta planilla ya entró al libro.';
  end if;

  -- Por defecto, el último día del mes trabajado.
  v_fecha := coalesce(p_fecha,
    (make_date(v_pl.anio, v_pl.mes, 1) + interval '1 month - 1 day')::date);

  select id into v_concepto from public.expense_concepts where codigo = 'PER-SUE';

  for r in
    select i.id as item_id, i.neto, i.nota, e.nombre_completo,
           e.project_id, e.centro_costo_id
      from public.hr_planilla_items i
      join public.hr_empleados e on e.id = i.empleado_id
     where i.planilla_id = p_planilla_id and i.neto > 0
  loop
    -- Quien trabaja para toda la empresa carga a Administración.
    v_proj := coalesce(r.project_id, private.proyecto_administracion());

    v_res := public.admin_record_expense(
      v_proj, v_fecha, 'sueldos'::expense_category,
      format('Sueldo %s/%s — %s', lpad(v_pl.mes::text, 2, '0'), v_pl.anio, r.nombre_completo),
      r.neto, 'BOB', r.nombre_completo, null, r.nota,
      null,               -- todavía no salió de ninguna caja
      null, r.centro_costo_id, 'empresa', null, null, v_concepto,
      null, 'planilla', null, null);

    update public.hr_planilla_items
       set expense_id = (v_res->>'expense_id')::uuid where id = r.item_id;
    v_total := v_total + r.neto;
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then raise exception 'PLANILLA_VACIA'; end if;

  update public.hr_planillas
     set estado = 'devengada', devengada_el = v_fecha, updated_at = now()
   where id = p_planilla_id;

  perform private.audit('team', v_actor, null, 'rrhh.planilla_devengada', null,
    'hr_planilla', p_planilla_id, null,
    jsonb_build_object('anio', v_pl.anio, 'mes', v_pl.mes, 'empleados', v_n,
                       'total', v_total, 'fecha', v_fecha));
  return jsonb_build_object('ok', true, 'empleados', v_n, 'total', v_total, 'fecha', v_fecha);
end;
$$;

-- ---------------------------------------------------------------------------
-- Pagar: cancela lo que se le debe al personal. Ya no crea el gasto —eso lo
-- hizo el devengado— sino que salda la deuda, por persona.
-- ---------------------------------------------------------------------------
create or replace function public.admin_pagar_planilla(
  p_planilla_id uuid, p_treasury_account_id uuid, p_fecha date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_actor uuid; v_pl public.hr_planillas%rowtype; r record;
  v_total numeric(14,2) := 0; v_n int := 0; v_fecha date; v_saldo numeric;
begin
  v_actor := private.assert_seccion('rrhh');
  select * into v_pl from public.hr_planillas where id = p_planilla_id for update;
  if not found then raise exception 'PLANILLA_NO_ENCONTRADA'; end if;
  if v_pl.estado = 'pagada' then raise exception 'YA_PAGADA'; end if;
  if v_pl.estado <> 'devengada' then
    raise exception 'PLANILLA_SIN_DEVENGAR'
      using detail = 'Primero se devenga la planilla: el sueldo es del mes trabajado.';
  end if;
  if not exists (select 1 from public.treasury_accounts
                  where id = p_treasury_account_id and is_active) then
    raise exception 'TREASURY_NOT_FOUND';
  end if;
  v_fecha := coalesce(p_fecha, current_date);

  for r in
    select i.expense_id, e.amount_bob
      from public.hr_planilla_items i
      join public.expenses e on e.id = i.expense_id
     where i.planilla_id = p_planilla_id and e.deleted_at is null
  loop
    v_saldo := round(r.amount_bob - private.pagado_de_egreso(r.expense_id), 2);
    if v_saldo > 0 then
      perform public.admin_pagar_egreso(r.expense_id, p_treasury_account_id, v_fecha, v_saldo, null);
      v_total := v_total + v_saldo;
      v_n := v_n + 1;
    end if;
  end loop;

  if v_n = 0 then
    raise exception 'PLANILLA_YA_PAGADA'
      using detail = 'No quedaba nada por pagar en esta planilla.';
  end if;

  update public.hr_planillas
     set estado = 'pagada', pagada_de = p_treasury_account_id,
         pagada_at = now(), updated_at = now()
   where id = p_planilla_id;

  perform private.audit('team', v_actor, null, 'rrhh.planilla_pagada', null,
    'hr_planilla', p_planilla_id, null,
    jsonb_build_object('anio', v_pl.anio, 'mes', v_pl.mes,
                       'empleados', v_n, 'total', v_total));
  return jsonb_build_object('ok', true, 'empleados', v_n, 'total', v_total);
end;
$$;

grant execute on function public.admin_devengar_planilla(uuid, date) to authenticated;
revoke execute on function public.admin_devengar_planilla(uuid, date) from anon;

-- La planilla y su estado en el libro, para la pantalla.
create or replace view public.v_planillas as
select pl.id, pl.anio, pl.mes, pl.estado, pl.devengada_el, pl.pagada_at,
       t.name as pagada_de,
       count(i.id) as empleados,
       coalesce(sum(i.neto), 0) as total,
       coalesce(sum(case when e.id is not null
                         then round(e.amount_bob - private.pagado_de_egreso(e.id), 2)
                         else 0 end), 0) as saldo
  from public.hr_planillas pl
  left join public.hr_planilla_items i on i.planilla_id = pl.id
  left join public.expenses e on e.id = i.expense_id and e.deleted_at is null
  left join public.treasury_accounts t on t.id = pl.pagada_de
 where private.ve_contabilidad() or private.nivel_de((select auth.uid()), 'rrhh') <> 'no'
 group by pl.id, pl.anio, pl.mes, pl.estado, pl.devengada_el, pl.pagada_at, t.name;

alter view public.v_planillas set (security_invoker = true);
grant select on public.v_planillas to authenticated;
revoke all on public.v_planillas from anon;
