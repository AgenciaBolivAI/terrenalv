-- LIBRO DE COMPRAS Y VENTAS IVA — lo que el contador que viene de CONTAB va
-- a buscar primero, y no estaba.
--
-- Es parte del módulo FISCAL: las facturas son documentos tributarios, no
-- operativos. El gerencial no las nombra (la regla de siempre) — acá se
-- registra la factura y, si corresponde, se apunta al movimiento del
-- gerencial que la respalda.
--
-- La aritmética boliviana, escrita donde se pueda leer:
--   · IVA 13% POR DENTRO: una factura de Bs 1.000 trae Bs 130 de crédito o
--     débito fiscal. No se suma por fuera.
--   · Compras con factura generan CRÉDITO fiscal (a favor).
--     Ventas con factura generan DÉBITO fiscal (a pagar).
--   · La tasa vive en una columna, no clavada en el código: si la norma
--     cambia, se cambia el dato.
--   · BANCARIZACIÓN: desde Bs 50.000 la transacción debe tener respaldo de
--     medio de pago bancario. El sistema marca las que superan el umbral y
--     les exige el dato; el umbral también es editable.

create table if not exists public.fiscal_facturas (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  -- compra = crédito fiscal | venta = débito fiscal
  tipo text not null,
  fecha date not null,
  nit text not null,
  razon_social text not null,
  numero_factura text not null,
  codigo_autorizacion text,
  importe_total numeric(14,2) not null,
  -- Lo que no lleva IVA dentro del total: ICE, exentos, tasas.
  importe_exento numeric(14,2) not null default 0,
  descuentos numeric(14,2) not null default 0,
  tasa_iva numeric(5,2) not null default 13,
  -- Calculado: (total − exento − descuentos) × tasa. Se guarda para que el
  -- libro histórico no cambie si algún día cambia la tasa.
  base_credito_debito numeric(14,2) not null,
  iva numeric(14,2) not null,
  -- Bancarización: obligatoria desde el umbral.
  requiere_bancarizacion boolean not null default false,
  medio_pago text,
  nro_documento_pago text,
  estado text not null default 'valida',
  anulada_note text,
  -- El respaldo en el gerencial, si existe: el egreso o el pago que la generó.
  origen text,
  origen_id uuid,
  nota text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fiscal_facturas_tipo_check check (tipo in ('compra','venta')),
  constraint fiscal_facturas_estado_check check (estado in ('valida','anulada')),
  constraint fiscal_facturas_total_check check (importe_total > 0),
  constraint fiscal_facturas_exento_check
    check (importe_exento >= 0 and descuentos >= 0
           and importe_exento + descuentos <= importe_total),
  constraint fiscal_facturas_nit_check check (btrim(nit) <> ''),
  constraint fiscal_facturas_numero_check check (btrim(numero_factura) <> ''),
  constraint fiscal_facturas_origen_check
    check ((origen is null and origen_id is null)
        or (origen in ('pago','egreso') and origen_id is not null)),
  -- Si requiere bancarización, el medio de pago es obligatorio.
  constraint fiscal_facturas_bancarizacion_check
    check (not requiere_bancarizacion
           or (btrim(coalesce(medio_pago,'')) <> ''))
);

create unique index if not exists fiscal_facturas_unica_uidx
  on public.fiscal_facturas (project_id, tipo, nit, numero_factura)
  where estado = 'valida';
create index if not exists fiscal_facturas_periodo_idx
  on public.fiscal_facturas (project_id, tipo, fecha);

alter table public.fiscal_facturas enable row level security;
drop policy if exists fiscal_facturas_lee on public.fiscal_facturas;
create policy fiscal_facturas_lee on public.fiscal_facturas
  for select to authenticated using (private.is_team());
drop trigger if exists solo_lectura on public.fiscal_facturas;
create trigger solo_lectura before insert or update or delete on public.fiscal_facturas
  for each row execute function private.tg_solo_lectura('fiscal');

-- El umbral de bancarización, editable.
insert into public.commission_policy (gestion) values (extract(year from current_date)::int)
on conflict (gestion) do nothing;

create table if not exists public.fiscal_parametros (
  clave text primary key,
  valor numeric not null,
  descripcion text,
  updated_at timestamptz not null default now()
);
insert into public.fiscal_parametros (clave, valor, descripcion) values
  ('bancarizacion_umbral', 50000, 'Desde este importe (Bs) la factura exige respaldo bancario.'),
  ('iva_tasa', 13, 'Tasa de IVA vigente (%). Las facturas guardan la suya propia.')
on conflict (clave) do nothing;

alter table public.fiscal_parametros enable row level security;
drop policy if exists fiscal_parametros_lee on public.fiscal_parametros;
create policy fiscal_parametros_lee on public.fiscal_parametros
  for select to authenticated using (private.is_team());
drop trigger if exists solo_lectura on public.fiscal_parametros;
create trigger solo_lectura before insert or update or delete on public.fiscal_parametros
  for each row execute function private.tg_solo_lectura('fiscal');

-- ---------- registrar una factura ------------------------------------------
create or replace function public.fiscal_registrar_factura(
  p_project_id uuid,
  p_tipo text,
  p_fecha date,
  p_nit text,
  p_razon_social text,
  p_numero_factura text,
  p_codigo_autorizacion text default null,
  p_importe_total numeric default null,
  p_importe_exento numeric default 0,
  p_descuentos numeric default 0,
  p_medio_pago text default null,
  p_nro_documento_pago text default null,
  p_origen text default null,
  p_origen_id uuid default null,
  p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_actor uuid;
  v_id uuid;
  v_tasa numeric;
  v_umbral numeric;
  v_base numeric(14,2);
  v_iva numeric(14,2);
  v_requiere boolean;
begin
  v_actor := private.assert_accounting();
  if p_tipo not in ('compra','venta') then raise exception 'TIPO_INVALIDO'; end if;
  if p_importe_total is null or p_importe_total <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if btrim(coalesce(p_nit,'')) = '' then raise exception 'NIT_REQUERIDO'; end if;
  if btrim(coalesce(p_razon_social,'')) = '' then raise exception 'RAZON_SOCIAL_REQUERIDA'; end if;
  if btrim(coalesce(p_numero_factura,'')) = '' then raise exception 'NUMERO_REQUERIDO'; end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  select valor into v_tasa from public.fiscal_parametros where clave = 'iva_tasa';
  select valor into v_umbral from public.fiscal_parametros where clave = 'bancarizacion_umbral';
  v_tasa := coalesce(v_tasa, 13);
  v_umbral := coalesce(v_umbral, 50000);

  -- IVA por dentro: la base es el total menos lo exento y los descuentos.
  v_base := round(p_importe_total - coalesce(p_importe_exento,0) - coalesce(p_descuentos,0), 2);
  if v_base < 0 then raise exception 'EXENTO_MAYOR_AL_TOTAL'; end if;
  v_iva := round(v_base * v_tasa / 100, 2);

  v_requiere := p_importe_total >= v_umbral;
  if v_requiere and btrim(coalesce(p_medio_pago,'')) = '' then
    raise exception 'BANCARIZACION_REQUERIDA'
      using detail = format('Desde Bs %s la factura exige el medio de pago bancario (transferencia, cheque, depósito) y su número de documento.', v_umbral);
  end if;

  insert into public.fiscal_facturas
    (project_id, tipo, fecha, nit, razon_social, numero_factura, codigo_autorizacion,
     importe_total, importe_exento, descuentos, tasa_iva, base_credito_debito, iva,
     requiere_bancarizacion, medio_pago, nro_documento_pago, origen, origen_id, nota, created_by)
  values
    (p_project_id, p_tipo, p_fecha, btrim(p_nit), btrim(p_razon_social),
     btrim(p_numero_factura), nullif(btrim(coalesce(p_codigo_autorizacion,'')),''),
     p_importe_total, coalesce(p_importe_exento,0), coalesce(p_descuentos,0),
     v_tasa, v_base, v_iva, v_requiere,
     nullif(btrim(coalesce(p_medio_pago,'')),''),
     nullif(btrim(coalesce(p_nro_documento_pago,'')),''),
     p_origen, p_origen_id, nullif(btrim(coalesce(p_nota,'')),''), v_actor)
  returning id into v_id;

  perform private.audit('team', v_actor, null, 'fiscal.factura', p_project_id,
    'fiscal_factura', v_id, null,
    jsonb_build_object('tipo', p_tipo, 'nit', p_nit, 'numero', p_numero_factura,
                       'total', p_importe_total, 'iva', v_iva));

  return jsonb_build_object('id', v_id, 'iva', v_iva, 'base', v_base,
                            'requiere_bancarizacion', v_requiere);
end;
$$;

create or replace function public.fiscal_anular_factura(p_id uuid, p_nota text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $$
declare v_actor uuid; v_f public.fiscal_facturas%rowtype;
begin
  v_actor := private.assert_accounting();
  if btrim(coalesce(p_nota,'')) = '' then raise exception 'NOTE_REQUIRED'; end if;
  select * into v_f from public.fiscal_facturas where id = p_id for update;
  if not found then raise exception 'FACTURA_NO_ENCONTRADA'; end if;
  if v_f.estado = 'anulada' then raise exception 'YA_ANULADA'; end if;
  update public.fiscal_facturas
     set estado = 'anulada', anulada_note = btrim(p_nota), updated_at = now()
   where id = p_id;
  perform private.audit('team', v_actor, null, 'fiscal.factura_anulada', v_f.project_id,
    'fiscal_factura', p_id, jsonb_build_object('numero', v_f.numero_factura),
    jsonb_build_object('nota', btrim(p_nota)));
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.fiscal_registrar_factura(uuid, text, date, text, text, text, text, numeric, numeric, numeric, text, text, text, uuid, text) to authenticated;
grant execute on function public.fiscal_anular_factura(uuid, text) to authenticated;
revoke execute on function public.fiscal_registrar_factura(uuid, text, date, text, text, text, text, numeric, numeric, numeric, text, text, text, uuid, text) from anon;
revoke execute on function public.fiscal_anular_factura(uuid, text) from anon;

-- ---------- los libros y la posición mensual del IVA ------------------------
create or replace view public.v_fiscal_libro_iva as
select f.project_id, f.tipo, f.fecha,
       to_char(f.fecha, 'YYYY-MM') as periodo,
       f.nit, f.razon_social, f.numero_factura, f.codigo_autorizacion,
       f.importe_total, f.importe_exento, f.descuentos,
       f.base_credito_debito, f.tasa_iva, f.iva,
       f.requiere_bancarizacion, f.medio_pago, f.nro_documento_pago,
       f.estado, f.origen, f.origen_id, f.nota, f.id
  from public.fiscal_facturas f;

alter view public.v_fiscal_libro_iva set (security_invoker = true);

create or replace view public.v_fiscal_posicion_iva as
select f.project_id,
       to_char(f.fecha, 'YYYY-MM') as periodo,
       round(sum(f.iva) filter (where f.tipo = 'venta'  and f.estado = 'valida'), 2) as debito_fiscal,
       round(sum(f.iva) filter (where f.tipo = 'compra' and f.estado = 'valida'), 2) as credito_fiscal,
       round(coalesce(sum(f.iva) filter (where f.tipo = 'venta'  and f.estado = 'valida'), 0)
           - coalesce(sum(f.iva) filter (where f.tipo = 'compra' and f.estado = 'valida'), 0), 2)
         as saldo_a_pagar,
       count(*) filter (where f.tipo = 'venta'  and f.estado = 'valida') as facturas_venta,
       count(*) filter (where f.tipo = 'compra' and f.estado = 'valida') as facturas_compra,
       count(*) filter (where f.requiere_bancarizacion and f.estado = 'valida') as con_bancarizacion
  from public.fiscal_facturas f
 group by f.project_id, to_char(f.fecha, 'YYYY-MM');

alter view public.v_fiscal_posicion_iva set (security_invoker = true);

-- El guardián de fugas debe conocer los objetos nuevos del módulo fiscal.
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'fiscal_fugas';

  if position('''fiscal_comprobantes'',''fiscal_lineas'',''fiscal_exclusiones'',
                            ''v_fiscal_libro_diario'',''v_fiscal_sumas_y_saldos'',''v_fiscal_pendiente''];' in v_def) = 0 then
    raise exception 'PARCHE_FUGAS_OBJETOS_NO_AGARRA';
  end if;
  v_def := replace(v_def,
    '''fiscal_comprobantes'',''fiscal_lineas'',''fiscal_exclusiones'',
                            ''v_fiscal_libro_diario'',''v_fiscal_sumas_y_saldos'',''v_fiscal_pendiente''];',
    '''fiscal_comprobantes'',''fiscal_lineas'',''fiscal_exclusiones'',''fiscal_facturas'',''fiscal_parametros'',
                            ''v_fiscal_libro_diario'',''v_fiscal_sumas_y_saldos'',''v_fiscal_pendiente'',
                            ''v_fiscal_libro_iva'',''v_fiscal_posicion_iva''];');

  if position('''fiscal_guardar_comprobante'',''fiscal_anular_comprobante'',' in v_def) = 0 then
    raise exception 'PARCHE_FUGAS_EXENTOS_NO_AGARRA';
  end if;
  v_def := replace(v_def,
    '''fiscal_guardar_comprobante'',''fiscal_anular_comprobante'',',
    '''fiscal_guardar_comprobante'',''fiscal_anular_comprobante'',
                            ''fiscal_registrar_factura'',''fiscal_anular_factura'',');
  execute v_def;
end $$;

select count(*) as fugas from private.fiscal_fugas();
