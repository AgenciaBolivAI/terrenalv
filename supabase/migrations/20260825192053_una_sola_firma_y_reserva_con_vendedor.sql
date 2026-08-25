-- El parche anterior dejó DOS versiones de mark_sold_offline conviviendo (17
-- y 18 argumentos). Con parámetros nombrados eso es una bomba: la llamada
-- puede caer en la vieja —que ignora el vendedor— sin que nadie lo note.
drop function if exists public.mark_sold_offline(
  uuid, text, text, text, text, numeric, text, public.payment_provider_kind,
  text, char, numeric, uuid, numeric, int, numeric, date, numeric);

-- Reservar de mostrador también anota quién la tomó.
create or replace function public.admin_reserve_offline(
  p_lot_id uuid,
  p_full_name text,
  p_ci text,
  p_phone text,
  p_email text default null,
  p_hours int default null,
  p_note text default null,
  p_provider public.payment_provider_kind default 'manual_qr',
  p_sold_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare v_out jsonb; v_res uuid;
begin
  -- La reserva la crea la función de siempre; acá solo se le pega el
  -- vendedor. Reescribirla entera para agregar una columna sería copiar
  -- doscientas líneas que después divergen.
  v_out := public.admin_reserve_offline_base(
    p_lot_id, p_full_name, p_ci, p_phone, p_email, p_hours, p_note, p_provider);
  v_res := (v_out->>'reservation_id')::uuid;
  if p_sold_by is not null and v_res is not null then
    perform public.admin_asignar_vendedor(v_res, p_sold_by);
  end if;
  return v_out;
end;
$fn$;
