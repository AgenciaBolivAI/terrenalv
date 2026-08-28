-- CADA LÍNEA DEL COMPROBANTE CONOCE SU CENTRO DE COSTOS.
--
-- El centro vivía solo en la CABECERA del comprobante, así que un asiento con
-- cinco líneas de cinco obras distintas tenía que ser cinco comprobantes. Y la
-- depreciación mensual ya sabía el centro de cada activo —`depreciacion_del_mes`
-- lo devuelve— pero `admin_depreciar_mes` lo tiraba al armar las líneas: el
-- gasto de depreciación quedaba sin repartir.
alter table public.journal_lines
  add column if not exists centro_costo_id uuid references public.centros_costo (id);

comment on column public.journal_lines.centro_costo_id is
  'El centro de esta línea. Si va vacío manda el de la cabecera del '
  'comprobante: así un asiento puede repartirse entre varias obras.';

create index if not exists journal_lines_centro_idx
  on public.journal_lines (centro_costo_id) where centro_costo_id is not null;

do $$
declare v_def text; v_ancla text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_save_voucher';

  v_ancla := 'insert into public.journal_lines (entry_id, account_code, debe, haber, glosa, sort_order)';
  if position(v_ancla in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA' using detail = 'admin_save_voucher ya no inserta las líneas como se esperaba.';
  end if;
  v_def := replace(v_def, v_ancla,
    'insert into public.journal_lines (entry_id, account_code, debe, haber, glosa, sort_order, centro_costo_id)');

  v_ancla := 'nullif(btrim(coalesce(v_line->>''glosa'', '''')), ''''), v_n);';
  if position(v_ancla in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA' using detail = 'admin_save_voucher ya no cierra los valores de la línea como se esperaba.';
  end if;
  execute replace(v_def, v_ancla,
    'nullif(btrim(coalesce(v_line->>''glosa'', '''')), ''''), v_n, nullif(v_line->>''centro_costo_id'', '''')::uuid);');
end $$;

do $$
declare v_def text; v_ancla text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_depreciar_mes';

  v_ancla := '''account_code'', r.cuenta_depreciacion, ''debe'', r.monto, ''haber'', 0,';
  if position(v_ancla in v_def) = 0 then
    raise exception 'PARCHE_NO_AGARRA' using detail = 'admin_depreciar_mes ya no arma la línea de depreciación como se esperaba.';
  end if;
  execute replace(v_def, v_ancla,
    '''account_code'', r.cuenta_depreciacion, ''debe'', r.monto, ''haber'', 0, ''centro_costo_id'', r.centro_costo_id,');
end $$;
