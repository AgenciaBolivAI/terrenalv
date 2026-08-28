-- PARA PUBLICAR EN EL MERCADO HAY QUE TENER CUENTA.
--
-- Publicar con solo el código de seguimiento no deja a nadie del otro lado:
-- ni a quién escribirle si aparece un interesado, ni a quién reclamarle la
-- comisión, ni con qué saludarlo el día de su aniversario. Ahora publicar,
-- editar y retirar exigen sesión, y que la compra esté RECLAMADA por esa
-- cuenta — o sea, que en algún momento haya probado con su código que es suya.
create or replace function public.mercado_publicar(
  p_tracking_code text,
  p_asking numeric,
  p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_res public.reservations%rowtype;
  v_id uuid;
  v_estado text;
  v_pct numeric;
  v_uid uuid := auth.uid();
begin
  if p_asking is null or p_asking <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if v_uid is null then raise exception 'NECESITA_CUENTA'; end if;

  select * into v_res from public.reservations
   where tracking_code = upper(btrim(coalesce(p_tracking_code, '')));
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if v_res.status <> 'confirmada' then raise exception 'NO_ES_VENTA'; end if;

  -- El equipo puede publicar por el cliente desde el panel; el cliente, solo
  -- lo suyo.
  if not private.is_team() and v_res.customer_id is distinct from v_uid then
    raise exception 'NO_ES_TU_COMPRA'
      using detail = 'Reclamá esta compra en tu cuenta con su código de seguimiento antes de publicarla.';
  end if;

  update public.market_listings
     set asking_price_bob = round(p_asking, 2),
         note = nullif(btrim(coalesce(p_note, '')), ''),
         updated_at = now()
   where reservation_id = v_res.id and status in ('activa','pausada')
  returning id, status into v_id, v_estado;

  if v_id is null then
    if exists (select 1 from public.market_listings
                where reservation_id = v_res.id and status = 'cerrada'
                  and closed_reason = 'cerrada por la oficina') then
      raise exception 'AVISO_CERRADO_POR_OFICINA';
    end if;
    v_pct := coalesce((select (value#>>'{}')::numeric from public.settings
                        where key = 'mercado_fee_pct' and project_id is null), 20);
    insert into public.market_listings (reservation_id, asking_price_bob, note, fee_pct)
    values (v_res.id, round(p_asking, 2), nullif(btrim(coalesce(p_note, '')), ''), v_pct)
    returning id into v_id;
    v_estado := 'activa';
  end if;

  perform private.audit('guest', v_uid,
    (select full_name from public.customers where id = v_uid),
    'mercado.publicado', v_res.project_id, 'market_listing', v_id, null,
    jsonb_build_object('tracking', v_res.tracking_code, 'pide', p_asking, 'estado', v_estado));

  return jsonb_build_object('listing_id', v_id, 'estado', v_estado);
end;
$$;

-- Retirar, igual: solo el dueño de la cuenta que la reclamó (o el equipo).
do $$
declare
  v_src text;
  v_old text := $blk$  select * into v_res from public.reservations
   where tracking_code = upper(btrim(coalesce(p_tracking_code, '')));
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;$blk$;
  v_new text := $blk$  select * into v_res from public.reservations
   where tracking_code = upper(btrim(coalesce(p_tracking_code, '')));
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if auth.uid() is null then raise exception 'NECESITA_CUENTA'; end if;
  if not private.is_team() and v_res.customer_id is distinct from auth.uid() then
    raise exception 'NO_ES_TU_COMPRA';
  end if;$blk$;
begin
  select pg_get_functiondef(oid) into v_src
  from pg_proc where proname='mercado_retirar' and pronamespace='public'::regnamespace;
  if position(v_old in v_src) = 0 then
    raise exception 'no encontré la búsqueda de la reserva en mercado_retirar';
  end if;
  execute replace(v_src, v_old, v_new);
end $$;

-- La consulta guarda QUIÉN preguntó cuando hay sesión: sin eso, el mercado no
-- tiene de dónde agarrar a nadie.
alter table public.market_inquiries
  add column if not exists customer_id uuid references public.customers(id) on delete set null;
