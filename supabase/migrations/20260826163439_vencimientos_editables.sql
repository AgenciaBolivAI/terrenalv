-- Las fechas de vencimiento se pueden corregir.
--
-- El plan se arma con la fecha del día que se firmó, pero la gente cobra el
-- 5, el 15 o a fin de mes. Si el cronograma no se puede acomodar a eso, la
-- mora que muestra el sistema es mentira: el comprador paga puntual y figura
-- atrasado todos los meses.
--
-- Dos formas, porque son dos necesidades distintas: correr TODO el
-- cronograma pendiente a otra fecha, o mover UNA cuota puntual (el mes que
-- viajó, el mes que se enfermó).

-- ---- Correr todas las cuotas pendientes a partir de una fecha.
create or replace function public.admin_mover_vencimientos(
  p_plan_id uuid,
  p_primera_fecha date,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid; v_plan public.installment_plans%rowtype;
  v_row record; v_i int := 0; v_n int := 0;
begin
  v_actor := private.assert_accounting();

  select * into v_plan from public.installment_plans where id = p_plan_id for update;
  if not found then raise exception 'PLAN_NO_ENCONTRADO'; end if;
  if v_plan.status <> 'activo' then raise exception 'PLAN_NO_ACTIVO'; end if;
  if p_primera_fecha is null then raise exception 'FECHA_REQUERIDA'; end if;
  -- Un cronograma que arranca hace dos años nace entero vencido.
  if p_primera_fecha < current_date - interval '1 year' then
    raise exception 'FECHA_DEMASIADO_VIEJA';
  end if;

  -- Solo las que todavía no se pagaron: mover una cuota ya pagada
  -- reescribiría cuándo pagó, que es un hecho.
  for v_row in
    select id from public.installments
     where plan_id = p_plan_id and status in ('pendiente','parcial')
     order by number
  loop
    update public.installments
       set due_date = (p_primera_fecha + (v_i || ' month')::interval)::date,
           updated_at = now()
     where id = v_row.id;
    v_i := v_i + 1;
    v_n := v_n + 1;
  end loop;

  update public.installment_plans
     set first_due_date = least(first_due_date, p_primera_fecha),
         note = coalesce(note || ' · ', '') || 'vencimientos movidos',
         updated_at = now()
   where id = p_plan_id;

  perform private.audit('team', v_actor, null, 'plan.vencimientos_movidos', v_plan.project_id,
    'reservation', v_plan.reservation_id, null,
    jsonb_build_object('plan_id', p_plan_id, 'desde', p_primera_fecha,
                       'cuotas', v_n, 'nota', p_note));

  return jsonb_build_object('ok', true, 'cuotas_movidas', v_n, 'desde', p_primera_fecha);
end;
$fn$;

-- ---- Mover UNA cuota.
create or replace function public.admin_mover_vencimiento_cuota(
  p_installment_id uuid,
  p_fecha date,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid; v_i public.installments%rowtype; v_plan public.installment_plans%rowtype;
begin
  v_actor := private.assert_accounting();

  select * into v_i from public.installments where id = p_installment_id for update;
  if not found then raise exception 'CUOTA_NO_ENCONTRADA'; end if;
  if v_i.status = 'pagada' then
    raise exception 'CUOTA_YA_PAGADA'
      using detail = 'Mover la fecha de una cuota pagada reescribiría cuándo pagó.';
  end if;
  if v_i.status = 'anulada' then raise exception 'CUOTA_ANULADA'; end if;
  if p_fecha is null then raise exception 'FECHA_REQUERIDA'; end if;

  select * into v_plan from public.installment_plans where id = v_i.plan_id;

  update public.installments
     set due_date = p_fecha, updated_at = now()
   where id = p_installment_id;

  perform private.audit('team', v_actor, null, 'cuota.vencimiento_movido', v_plan.project_id,
    'reservation', v_plan.reservation_id,
    jsonb_build_object('cuota', v_i.number, 'vencia', v_i.due_date),
    jsonb_build_object('vence', p_fecha, 'nota', p_note));

  return jsonb_build_object('ok', true, 'cuota', v_i.number, 'vence', p_fecha);
end;
$fn$;

revoke execute on function
  public.admin_mover_vencimientos(uuid, date, text),
  public.admin_mover_vencimiento_cuota(uuid, date, text) from public, anon;
grant execute on function
  public.admin_mover_vencimientos(uuid, date, text),
  public.admin_mover_vencimiento_cuota(uuid, date, text) to authenticated, service_role;
