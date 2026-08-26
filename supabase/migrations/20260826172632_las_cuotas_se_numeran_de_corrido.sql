-- Cuando se reprograma un plan, el cronograma nuevo arrancaba en el número
-- siguiente al más alto que HUBIERA EXISTIDO, contando las cuotas anuladas.
-- Un plan de 12 al que se le pagó la primera y se le cambió el plazo quedaba
-- numerado 1, 13, 14, 15… El comprador recibe un papel que salta del 1 al 13
-- y no hay forma de explicarle por qué: para él son nueve cuotas, la primera
-- ya la pagó y le quedan ocho.
--
-- Las anuladas no se borran —son el historial de lo que se pactó antes— pero
-- se corren detrás, fuera de la vista. Lo que el comprador ve va 1, 2, 3…

create or replace function private.renumerar_cuotas(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_offset int;
  v_vivas  int;
begin
  -- Primero se corren TODAS a un rango que no puede chocar con nada: la
  -- columna tiene un único (plan_id, number) y renumerar en el lugar se
  -- pisaría a sí mismo a mitad de camino.
  select coalesce(max(number), 0) + 1000 into v_offset
    from public.installments where plan_id = p_plan_id;

  update public.installments
     set number = number + v_offset
   where plan_id = p_plan_id;

  -- Lo que el comprador ve, en el orden en que lo va a pagar.
  with vivas as (
    select id, row_number() over (order by due_date, number) as n
      from public.installments
     where plan_id = p_plan_id and status <> 'anulada'
  )
  update public.installments i set number = v.n
    from vivas v where i.id = v.id;

  select count(*) into v_vivas
    from public.installments
   where plan_id = p_plan_id and status <> 'anulada';

  -- Las anuladas, detrás, conservando el orden que tenían entre ellas.
  with muertas as (
    select id, row_number() over (order by number) as n
      from public.installments
     where plan_id = p_plan_id and status = 'anulada'
  )
  update public.installments i set number = v_vivas + m.n
    from muertas m where i.id = m.id;
end;
$$;

revoke all on function private.renumerar_cuotas(uuid) from public, anon, authenticated;
