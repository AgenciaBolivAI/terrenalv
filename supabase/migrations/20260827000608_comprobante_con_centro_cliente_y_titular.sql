-- El comprobante manual también carga a un centro, puede ser de un cliente y
-- puede estar a nombre de un tercero. Firma vieja fuera antes de la nueva.

drop function if exists public.admin_save_voucher(
  uuid, date, voucher_kind, text, jsonb, uuid, boolean);

create or replace function public.admin_save_voucher(
  p_project_id uuid,
  p_entry_date date,
  p_kind voucher_kind,
  p_glosa text,
  p_lines jsonb,
  p_entry_id uuid default null,
  p_post boolean default false,
  p_centro_costo_id uuid default null,
  p_reservation_id uuid default null,
  p_titular text default 'empresa',
  p_titular_nombre text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $function$
declare
  v_actor uuid;
  v_id uuid;
  v_number text;
  v_debe numeric(14,2) := 0;
  v_haber numeric(14,2) := 0;
  v_n int := 0;
  v_line jsonb;
  v_status public.voucher_status;
  v_titular text;
  v_titular_nombre text;
begin
  v_actor := private.assert_accounting();

  if btrim(coalesce(p_glosa, '')) = '' then raise exception 'GLOSA_REQUIRED'; end if;
  if p_entry_date is null then raise exception 'DATE_REQUIRED'; end if;
  perform private.assert_periodo_abierto(p_project_id, p_entry_date);

  if p_centro_costo_id is not null
     and not exists (select 1 from public.centros_costo cc
                      where cc.id = p_centro_costo_id and cc.is_active
                        and (cc.project_id is null or cc.project_id = p_project_id)) then
    raise exception 'CENTRO_COSTO_NO_ENCONTRADO'
      using detail = 'Ese centro de costos no existe, está inactivo o es de otra urbanización.';
  end if;

  v_titular := coalesce(nullif(btrim(coalesce(p_titular, '')), ''), 'empresa');
  if v_titular not in ('empresa','tercero') then raise exception 'TITULAR_INVALIDO'; end if;
  v_titular_nombre := nullif(btrim(coalesce(p_titular_nombre, '')), '');
  if v_titular = 'tercero' and v_titular_nombre is null then
    raise exception 'TITULAR_SIN_NOMBRE'
      using detail = 'Si el comprobante está a nombre de un tercero, hay que decir de quién.';
  end if;
  if v_titular = 'empresa' then v_titular_nombre := null; end if;

  -- Cuadre y validez de cada línea, antes de tocar nada.
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_n := v_n + 1;
    if not exists (select 1 from public.chart_of_accounts
                    where code = v_line->>'account_code' and is_active) then
      raise exception 'CUENTA_INVALIDA';
    end if;
    v_debe  := v_debe  + coalesce((v_line->>'debe')::numeric, 0);
    v_haber := v_haber + coalesce((v_line->>'haber')::numeric, 0);
  end loop;

  if p_post then
    if v_n < 2 then raise exception 'MINIMO_DOS_LINEAS'; end if;
    if v_debe <= 0 then raise exception 'IMPORTE_CERO'; end if;
    -- Un centavo de diferencia es un asiento mal hecho, no un redondeo.
    if round(v_debe, 2) <> round(v_haber, 2) then raise exception 'NO_CUADRA'; end if;
  end if;

  v_status := case when p_post then 'registrado'::public.voucher_status
                   else 'borrador'::public.voucher_status end;

  if p_entry_id is null then
    v_number := private.next_voucher_number(p_project_id, p_kind);
    insert into public.journal_entries
      (project_id, number, kind, entry_date, glosa, status, created_by,
       posted_by, posted_at, centro_costo_id, reservation_id, titular, titular_nombre)
    values
      (p_project_id, v_number, p_kind, p_entry_date, btrim(p_glosa), v_status, v_actor,
       case when p_post then v_actor end, case when p_post then now() end,
       p_centro_costo_id, p_reservation_id, v_titular, v_titular_nombre)
    returning id into v_id;
  else
    -- Un comprobante ya registrado o anulado no se edita: se anula y se hace
    -- otro, que es como se corrige un asiento sin borrar historia.
    select status into v_status from public.journal_entries where id = p_entry_id;
    if v_status is null then raise exception 'VOUCHER_NOT_FOUND'; end if;
    if v_status <> 'borrador' then raise exception 'VOUCHER_NOT_EDITABLE'; end if;

    update public.journal_entries
       set entry_date = p_entry_date, kind = p_kind, glosa = btrim(p_glosa),
           status = case when p_post then 'registrado' else 'borrador' end,
           posted_by = case when p_post then v_actor else null end,
           posted_at = case when p_post then now() else null end,
           centro_costo_id = p_centro_costo_id,
           reservation_id = p_reservation_id,
           titular = v_titular,
           titular_nombre = v_titular_nombre,
           updated_at = now()
     where id = p_entry_id
    returning id, number into v_id, v_number;

    delete from public.journal_lines where entry_id = v_id;
  end if;

  v_n := 0;
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_n := v_n + 1;
    insert into public.journal_lines (entry_id, account_code, debe, haber, glosa, sort_order)
    values (v_id, v_line->>'account_code',
            round(coalesce((v_line->>'debe')::numeric, 0), 2),
            round(coalesce((v_line->>'haber')::numeric, 0), 2),
            nullif(btrim(coalesce(v_line->>'glosa', '')), ''), v_n);
  end loop;

  perform private.audit('team', v_actor, null,
    case when p_post then 'voucher.posted' else 'voucher.saved' end, p_project_id,
    'journal_entry', v_id, null,
    jsonb_build_object('numero', v_number, 'fecha', p_entry_date,
                       'debe', v_debe, 'haber', v_haber, 'lineas', v_n,
                       'centro_costo', p_centro_costo_id, 'titular', v_titular));

  return jsonb_build_object('entry_id', v_id, 'number', v_number,
                            'debe', v_debe, 'haber', v_haber);
end;
$function$;

-- ---------- lo que se mira: por centro y por cliente ------------------------
create or replace view public.v_centros_costo as
select cc.id, cc.project_id, p.name as proyecto, cc.codigo, cc.nombre, cc.is_active,
       coalesce(m.cargado, 0)  as cargado,
       coalesce(m.acreditado, 0) as acreditado,
       coalesce(m.cargado, 0) - coalesce(m.acreditado, 0) as neto,
       coalesce(m.movimientos, 0) as movimientos,
       m.ultimo
  from public.centros_costo cc
  left join public.projects p on p.id = cc.project_id
  left join lateral (
    select sum(d.debe) as cargado, sum(d.haber) as acreditado,
           count(*) as movimientos, max(d.fecha) as ultimo
      from public.v_libro_diario d
     where d.centro_costo_id = cc.id
  ) m on true;

alter view public.v_centros_costo set (security_invoker = true);

-- El mayor de cada cliente: todo lo que pasó por su nombre, en un solo lugar.
create or replace view public.v_mayor_por_cliente as
select d.cliente_ci, max(d.cliente) as cliente, d.project_id,
       max(pr.name) as proyecto,
       count(*) as movimientos,
       round(sum(d.debe), 2) as debe,
       round(sum(d.haber), 2) as haber,
       round(sum(d.debe) - sum(d.haber), 2) as saldo,
       min(d.fecha) as primera,
       max(d.fecha) as ultima
  from public.v_libro_diario d
  left join public.projects pr on pr.id = d.project_id
 where d.cliente_ci is not null
 group by d.cliente_ci, d.project_id;

alter view public.v_mayor_por_cliente set (security_invoker = true);
