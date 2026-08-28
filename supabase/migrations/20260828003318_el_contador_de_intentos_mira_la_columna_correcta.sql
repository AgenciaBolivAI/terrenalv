-- La bitácora fecha con `occurred_at`, no con `created_at`: el contador de
-- intentos fallidos reventaba en la primera consulta y se llevaba puesta la
-- función entera — hasta el reclamo legítimo fallaba. Verificado probándola.
do $$
declare
  v_src text;
  v_old text := $blk$     and created_at > now() - interval '1 hour';$blk$;
  v_new text := $blk$     and occurred_at > now() - interval '1 hour';$blk$;
begin
  select pg_get_functiondef(oid) into v_src
  from pg_proc where proname='reclamar_mi_compra' and pronamespace='public'::regnamespace;
  if position(v_old in v_src) = 0 then
    raise exception 'no encontré el contador de intentos';
  end if;
  execute replace(v_src, v_old, v_new);
end $$;
