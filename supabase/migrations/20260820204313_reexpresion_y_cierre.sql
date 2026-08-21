-- Reexpresión monetaria (UFV) y cierre de gestión.
--
-- Las dos generan asientos automáticos, marcados is_automatic para que nadie
-- los edite a mano: un ajuste por inflación retocado o un cierre alterado
-- descuadran la gestión entera sin dejar rastro de por qué.

-- ============================================================================
-- UFV: carga de cotizaciones
-- ============================================================================
create or replace function public.admin_set_ufv(p_date date, p_value numeric, p_source text default 'manual')
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare v_actor uuid;
begin
  v_actor := private.assert_accounting();
  if p_value is null or p_value <= 0 then raise exception 'INVALID_UFV'; end if;
  if p_date is null then raise exception 'DATE_REQUIRED'; end if;

  insert into public.ufv_rates (rate_date, value, source)
  values (p_date, p_value, coalesce(p_source, 'manual'))
  on conflict (rate_date) do update set value = excluded.value, source = excluded.source;

  return jsonb_build_object('ok', true, 'fecha', p_date, 'valor', p_value);
end;
$fn$;

/**
 * UFV vigente a una fecha: la del día, o la última publicada antes.
 * El BCB no publica todos los días (feriados), así que buscar exacto devolvería
 * nulo justo cuando se cierra un mes que termina en domingo.
 */
create or replace function public.ufv_at(p_date date)
returns numeric
language sql
stable
security invoker
set search_path = public
as $fn$
  select value from public.ufv_rates
   where rate_date <= p_date order by rate_date desc limit 1;
$fn$;

-- ============================================================================
-- Reexpresión monetaria
-- ============================================================================
/**
 * Calcula el ajuste por inflación (AITB) de un período.
 *
 * En Bolivia los rubros no monetarios se reexpresan por la variación de la UFV.
 * Acá se reexpresa el PATRIMONIO, que es el caso que aplica a una urbanizadora
 * sin inventario ni activo fijo relevante: el capital y los resultados
 * acumulados valen menos bolivianos al final del período que al principio, y
 * esa pérdida de poder adquisitivo se reconoce contra AITB.
 *
 * Devuelve el cálculo SIN registrar nada — quien firma decide si lo asienta.
 */
create or replace function public.rep_reexpresion(
  p_project_id uuid,
  p_desde date,
  p_hasta date
)
returns table (
  ufv_inicial numeric, ufv_final numeric, factor numeric,
  patrimonio_inicial numeric, ajuste numeric
)
language sql
stable
security invoker
set search_path = public, extensions
as $fn$
  with u as (
    select public.ufv_at(p_desde) as ini, public.ufv_at(p_hasta) as fin
  ),
  pat as (
    select coalesce(sum(case when c.kind in ('pasivo','patrimonio')
                             then d.haber - d.debe else 0 end), 0) as saldo
      from public.v_libro_diario d
      join public.chart_of_accounts c on c.code = d.cuenta
     where d.project_id = p_project_id
       and c.kind = 'patrimonio'
       and d.fecha < p_desde
  )
  select
    u.ini,
    u.fin,
    case when u.ini is null or u.ini = 0 then null else round(u.fin / u.ini, 6) end,
    pat.saldo,
    case when u.ini is null or u.ini = 0 or u.fin is null then null
         else round(pat.saldo * (u.fin / u.ini - 1), 2) end
  from u, pat;
$fn$;

create or replace function public.admin_post_reexpresion(
  p_project_id uuid,
  p_desde date,
  p_hasta date
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid;
  v_r record;
  v_id uuid;
  v_number text;
begin
  v_actor := private.assert_accounting();
  perform private.assert_periodo_abierto(p_project_id, p_hasta);

  select * into v_r from public.rep_reexpresion(p_project_id, p_desde, p_hasta);
  if v_r.ufv_inicial is null or v_r.ufv_final is null then raise exception 'FALTA_UFV'; end if;
  if v_r.ajuste is null or round(v_r.ajuste, 2) = 0 then raise exception 'AJUSTE_CERO'; end if;

  v_number := private.next_voucher_number(p_project_id, 'ajuste');
  insert into public.journal_entries
    (project_id, number, kind, entry_date, glosa, status, is_automatic, created_by, posted_by, posted_at)
  values
    (p_project_id, v_number, 'ajuste', p_hasta,
     format('Reexpresión monetaria UFV %s a %s (factor %s)',
            to_char(p_desde,'DD/MM/YYYY'), to_char(p_hasta,'DD/MM/YYYY'), v_r.factor),
     'registrado', true, v_actor, v_actor, now())
  returning id into v_id;

  -- La pérdida por inflación es gasto (AITB) contra el ajuste del patrimonio.
  -- Si el ajuste diera negativo, los lados se invierten.
  insert into public.journal_lines (entry_id, account_code, debe, haber, sort_order) values
    (v_id, '5711', greatest(v_r.ajuste, 0), greatest(-v_r.ajuste, 0), 1),
    (v_id, '3411', greatest(-v_r.ajuste, 0), greatest(v_r.ajuste, 0), 2);

  perform private.audit('team', v_actor, null, 'reexpresion.posted', p_project_id,
    'journal_entry', v_id, null,
    jsonb_build_object('numero', v_number, 'ufv_ini', v_r.ufv_inicial,
                       'ufv_fin', v_r.ufv_final, 'ajuste', v_r.ajuste));

  return jsonb_build_object('entry_id', v_id, 'number', v_number, 'ajuste', v_r.ajuste);
end;
$fn$;

-- ============================================================================
-- Cierre de gestión
-- ============================================================================
/**
 * Cierra un ejercicio: lleva ingresos y gastos a cero contra el Resultado de la
 * Gestión, y marca el período cerrado para que no entren asientos con fecha
 * dentro de él.
 *
 * El asiento de cierre se genera en la ÚLTIMA fecha del período y se marca
 * automático. El período se cierra después de asentarlo — al revés, el propio
 * cierre chocaría con la regla que acaba de imponer.
 */
create or replace function public.admin_close_period(
  p_project_id uuid,
  p_year int,
  p_starts date default null,
  p_ends date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid;
  v_starts date;
  v_ends date;
  v_period uuid;
  v_id uuid;
  v_number text;
  v_res numeric(14,2) := 0;
  v_n int := 0;
  r record;
begin
  v_actor := private.assert_admin();

  v_starts := coalesce(p_starts, make_date(p_year, 1, 1));
  v_ends   := coalesce(p_ends,   make_date(p_year, 12, 31));

  if exists (select 1 from public.fiscal_periods
              where project_id = p_project_id and year = p_year and status = 'cerrado') then
    raise exception 'PERIODO_YA_CERRADO';
  end if;

  v_number := private.next_voucher_number(p_project_id, 'cierre');
  insert into public.journal_entries
    (project_id, number, kind, entry_date, glosa, status, is_automatic, created_by, posted_by, posted_at)
  values
    (p_project_id, v_number, 'cierre', v_ends,
     format('Cierre de gestión %s', p_year), 'registrado', true, v_actor, v_actor, now())
  returning id into v_id;

  -- Cada cuenta de resultado se lleva a cero por su lado contrario.
  for r in
    select d.cuenta, c.kind,
           sum(d.debe) - sum(d.haber) as neto
      from public.v_libro_diario d
      join public.chart_of_accounts c on c.code = d.cuenta
     where d.project_id = p_project_id
       and c.kind in ('ingreso', 'gasto')
       and d.fecha between v_starts and v_ends
     group by d.cuenta, c.kind
    having round(sum(d.debe) - sum(d.haber), 2) <> 0
  loop
    v_n := v_n + 1;
    -- neto > 0 significa saldo deudor (gasto): se cancela por el haber.
    insert into public.journal_lines (entry_id, account_code, debe, haber, sort_order)
    values (v_id, r.cuenta, greatest(-r.neto, 0), greatest(r.neto, 0), v_n);
    v_res := v_res - r.neto;
  end loop;

  if v_n = 0 then
    delete from public.journal_entries where id = v_id;
    raise exception 'SIN_MOVIMIENTOS';
  end if;

  -- La contrapartida: el resultado de la gestión al patrimonio.
  v_n := v_n + 1;
  insert into public.journal_lines (entry_id, account_code, debe, haber, sort_order)
  values (v_id, '3611', greatest(-v_res, 0), greatest(v_res, 0), v_n);

  insert into public.fiscal_periods
    (project_id, year, starts_on, ends_on, status, closed_at, closed_by, closing_entry_id)
  values (p_project_id, p_year, v_starts, v_ends, 'cerrado', now(), v_actor, v_id)
  on conflict (project_id, year) do update
    set status = 'cerrado', closed_at = now(), closed_by = v_actor,
        closing_entry_id = v_id, starts_on = v_starts, ends_on = v_ends
  returning id into v_period;

  perform private.audit('team', v_actor, null, 'period.closed', p_project_id,
    'journal_entry', v_id, null,
    jsonb_build_object('gestion', p_year, 'resultado', v_res, 'cuentas', v_n - 1));

  return jsonb_build_object('period_id', v_period, 'entry_id', v_id,
                            'number', v_number, 'resultado', v_res);
end;
$fn$;

create or replace function public.admin_reopen_period(p_project_id uuid, p_year int, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $fn$
declare
  v_actor uuid;
  v_p public.fiscal_periods%rowtype;
begin
  v_actor := private.assert_admin();
  if btrim(coalesce(p_note, '')) = '' then raise exception 'NOTE_REQUIRED'; end if;

  select * into v_p from public.fiscal_periods where project_id = p_project_id and year = p_year;
  if v_p.id is null then raise exception 'PERIODO_NO_ENCONTRADO'; end if;
  if v_p.status <> 'cerrado' then raise exception 'PERIODO_NO_CERRADO'; end if;

  -- Reabrir borra el asiento de cierre: dejarlo puesto duplicaría el resultado
  -- cuando se vuelva a cerrar.
  delete from public.journal_entries where id = v_p.closing_entry_id;

  update public.fiscal_periods
     set status = 'abierto', closed_at = null, closed_by = null, closing_entry_id = null
   where id = v_p.id;

  perform private.audit('team', v_actor, null, 'period.reopened', p_project_id,
    'journal_entry', v_p.closing_entry_id,
    jsonb_build_object('status', 'cerrado'),
    jsonb_build_object('status', 'abierto', 'nota', p_note));

  return jsonb_build_object('ok', true);
end;
$fn$;

revoke execute on function
  public.admin_set_ufv(date, numeric, text),
  public.ufv_at(date),
  public.rep_reexpresion(uuid, date, date),
  public.admin_post_reexpresion(uuid, date, date),
  public.admin_close_period(uuid, int, date, date),
  public.admin_reopen_period(uuid, int, text)
from public, anon;

grant execute on function
  public.admin_set_ufv(date, numeric, text),
  public.ufv_at(date),
  public.rep_reexpresion(uuid, date, date),
  public.admin_post_reexpresion(uuid, date, date),
  public.admin_close_period(uuid, int, date, date),
  public.admin_reopen_period(uuid, int, text)
to authenticated, service_role;
