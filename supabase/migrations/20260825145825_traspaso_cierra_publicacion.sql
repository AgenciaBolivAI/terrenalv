-- El traspaso cierra la publicación del mercado si la había: el lote ya cambió
-- de manos y dejarlo en la vidriera invitaría consultas sobre algo vendido.
--
-- (El primer intento de este parche se aplicó junto a una prueba que falló, y
-- al abortar la transacción se llevó el parche consigo — por eso va solo.)
do $patch$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='admin_traspasar_venta';
  if position('cerrar_publicacion_por_traspaso' in v_def) > 0 then
    return;
  end if;
  v_def := replace(v_def,
    'perform private.audit(''team'', v_actor, null, ''venta.traspasada''',
    'perform private.cerrar_publicacion_por_traspaso(p_reservation_id);

  perform private.audit(''team'', v_actor, null, ''venta.traspasada''');
  execute v_def;
end;
$patch$;

-- Y la administración del mercado desde el panel: la oficina edita, pausa,
-- cierra y marca consultas atendidas. El mercado es una vidriera de la
-- empresa; la empresa manda en su vidriera.
create or replace function public.admin_mercado_editar(
  p_listing_id uuid,
  p_asking numeric default null,
  p_note text default null,
  p_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare v_actor uuid; v_ml public.market_listings%rowtype;
begin
  v_actor := private.assert_accounting();
  if p_asking is not null and p_asking <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_status is not null and p_status not in ('activa','pausada','cerrada') then
    raise exception 'INVALID_STATUS';
  end if;

  update public.market_listings
     set asking_price_bob = coalesce(round(p_asking, 2), asking_price_bob),
         note = case when p_note is null then note else nullif(btrim(p_note), '') end,
         status = coalesce(p_status, status),
         closed_reason = case when p_status = 'cerrada' then 'cerrada por la oficina'
                              else closed_reason end,
         updated_at = now()
   where id = p_listing_id
  returning * into v_ml;
  if not found then raise exception 'LISTING_NOT_FOUND'; end if;

  perform private.audit('team', v_actor, null, 'mercado.editado',
    (select project_id from public.reservations where id = v_ml.reservation_id),
    'market_listing', p_listing_id, null,
    jsonb_build_object('pide', p_asking, 'estado', p_status));

  return jsonb_build_object('ok', true);
end;
$fn$;

create or replace function public.admin_mercado_atender(p_inquiry_id uuid, p_atendida boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare v_actor uuid;
begin
  v_actor := private.assert_team();
  update public.market_inquiries set atendida = coalesce(p_atendida, true)
   where id = p_inquiry_id;
  if not found then raise exception 'INQUIRY_NOT_FOUND'; end if;
  return jsonb_build_object('ok', true);
end;
$fn$;

revoke execute on function
  public.admin_mercado_editar(uuid, numeric, text, text),
  public.admin_mercado_atender(uuid, boolean)
from public, anon;
grant execute on function
  public.admin_mercado_editar(uuid, numeric, text, text),
  public.admin_mercado_atender(uuid, boolean)
to authenticated, service_role;
