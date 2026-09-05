-- Cuando alguien que YA nos compró se crea la cuenta, sus lotes tienen que
-- estar adentro desde el primer segundo. Hasta ahora la cuenta nacía vacía y
-- había que reclamar cada compra a mano con el código del contrato.
--
-- POR QUÉ NO ALCANZA EL CORREO SOLO: la cuenta se crea con el correo dado por
-- confirmado (`email_confirm: true`, sin vuelta por el correo), así que nadie
-- probó que sea suyo. Vincular por correo a secas le entregaría el contrato,
-- los pagos y el derecho a publicar el lote a cualquiera que sepa la dirección
-- de un comprador. Así que se piden las DOS cosas que el comprador sabe de
-- memoria y un extraño no: su correo y su carnet. Es lo mismo que exige
-- `reclamar_mi_compra` (código + carnet), con el correo en lugar del código.
--
-- Si el correo coincide pero no hay carnet, no se vincula nada y se avisa
-- cuántas compras esperan: la pantalla le pide el carnet y listo.
create or replace function public.vincular_mis_compras()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_cli public.customers%rowtype;
  v_correo text;
  v_vinculadas int := 0;
  v_esperando int := 0;
  v_r record;
begin
  if v_uid is null then raise exception 'NO_SESSION'; end if;
  select * into v_cli from public.customers where id = v_uid;
  if not found then raise exception 'SIN_CUENTA'; end if;

  v_correo := lower(btrim(coalesce(v_cli.email, '')));
  if v_correo = '' then
    return jsonb_build_object('ok', true, 'vinculadas', 0, 'esperando', 0);
  end if;

  -- Cuántas compras hay a ese correo, todavía de nadie.
  select count(*) into v_esperando
    from public.reservations r
   where lower(btrim(coalesce(r.buyer_email, ''))) = v_correo
     and r.customer_id is null;

  -- Sin carnet cargado no se vincula: falta la segunda llave.
  if v_cli.ci_normalized is null then
    return jsonb_build_object('ok', true, 'vinculadas', 0,
                              'esperando', v_esperando, 'falta_carnet', v_esperando > 0);
  end if;

  for v_r in
    select r.id, r.tracking_code, r.project_id
      from public.reservations r
     where lower(btrim(coalesce(r.buyer_email, ''))) = v_correo
       and r.buyer_ci_normalized is not null
       and r.buyer_ci_normalized = v_cli.ci_normalized
       and r.customer_id is null
  loop
    update public.reservations
       set customer_id = v_uid, updated_at = now()
     where id = v_r.id and customer_id is null;
    if found then
      v_vinculadas := v_vinculadas + 1;
      perform private.audit('guest', v_uid, v_cli.full_name, 'compra.vinculada_por_correo',
        v_r.project_id, 'reservation', v_r.id, null,
        jsonb_build_object('tracking_code', v_r.tracking_code, 'correo', v_correo));
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'vinculadas', v_vinculadas,
                            'esperando', greatest(v_esperando - v_vinculadas, 0),
                            'falta_carnet', false);
end;
$function$;

grant execute on function public.vincular_mis_compras() to authenticated;

-- Y que pase solo al crear la cuenta: `alta_de_cliente` ya recibe el correo y
-- el carnet, así que engancha las compras en el mismo movimiento.
do $$
declare
  v_def text;
  v_anchor text := $a$  perform private.audit('guest', p_uid, v_nombre, 'cliente.registrado',$a$;
  v_extra text := $x$  -- Sus compras entran con él: mismo correo y mismo carnet.
  begin
    v_vinculadas := (public.vincular_mis_compras_de(p_uid) ->> 'vinculadas')::int;
  exception when others then
    v_vinculadas := 0;  -- que un enganche fallido no impida crear la cuenta
  end;

$x$;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'alta_de_cliente';
  if position(v_anchor in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA: no se encontró el ancla en alta_de_cliente';
  end if;
  if position('vincular_mis_compras_de' in v_def) > 0 then
    raise exception 'PARCHE_NO_AGARRA: ya estaba enganchado';
  end if;
  v_def := replace(v_def, '  v_recientes int;', E'  v_recientes int;\n  v_vinculadas int := 0;');
  v_def := replace(v_def, v_anchor, v_extra || v_anchor);
  v_def := replace(v_def,
    $o$return jsonb_build_object('ok', true, 'customer_id', p_uid);$o$,
    $n$return jsonb_build_object('ok', true, 'customer_id', p_uid, 'vinculadas', v_vinculadas);$n$);
  execute v_def;
end $$;

-- La misma lógica, pero para un uid dado: `alta_de_cliente` corre ANTES de que
-- exista sesión, así que no puede apoyarse en auth.uid().
create or replace function public.vincular_mis_compras_de(p_uid uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $function$
declare
  v_cli public.customers%rowtype;
  v_correo text;
  v_vinculadas int := 0;
  v_r record;
begin
  select * into v_cli from public.customers where id = p_uid;
  if not found then return jsonb_build_object('ok', false, 'vinculadas', 0); end if;
  v_correo := lower(btrim(coalesce(v_cli.email, '')));
  if v_correo = '' or v_cli.ci_normalized is null then
    return jsonb_build_object('ok', true, 'vinculadas', 0);
  end if;

  for v_r in
    select r.id, r.tracking_code, r.project_id
      from public.reservations r
     where lower(btrim(coalesce(r.buyer_email, ''))) = v_correo
       and r.buyer_ci_normalized is not null
       and r.buyer_ci_normalized = v_cli.ci_normalized
       and r.customer_id is null
  loop
    update public.reservations set customer_id = p_uid, updated_at = now()
     where id = v_r.id and customer_id is null;
    if found then
      v_vinculadas := v_vinculadas + 1;
      perform private.audit('guest', p_uid, v_cli.full_name, 'compra.vinculada_por_correo',
        v_r.project_id, 'reservation', v_r.id, null,
        jsonb_build_object('tracking_code', v_r.tracking_code, 'correo', v_correo));
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'vinculadas', v_vinculadas);
end;
$function$;
