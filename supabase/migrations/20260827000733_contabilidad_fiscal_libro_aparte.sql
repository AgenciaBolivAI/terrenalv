-- CONTABILIDAD FISCAL — un libro aparte, que mira al gerencial y nunca al revés.
--
-- El gerencial (lo que ya existía) es la verdad del negocio: TODA la plata,
-- esté a nombre de quien esté. El fiscal es lo que la empresa declara. Son
-- dos cosas distintas y por eso viven en dos libros distintos.
--
-- LA REGLA, que es la razón de ser de todo esto:
--   · el fiscal LEE del gerencial (importa movimientos, apunta a sus ids),
--   · el gerencial NO SABE que el fiscal existe.
-- Ninguna tabla, vista o función del gerencial nombra nada de acá. No hay
-- una sola llave foránea que apunte de gerencial hacia fiscal — todas van al
-- revés. Un guardián en verificar_integridad() lo comprueba en cada build,
-- porque una regla que no se verifica dura hasta el primer apuro.
--
-- Ojo con el nombre: ya existía public.fiscal_periods, que es del GERENCIAL
-- (las gestiones contables). Por eso el guardián no trabaja por prefijo sino
-- con la lista explícita de objetos de este módulo.

create table if not exists public.fiscal_comprobantes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  numero text not null,
  fecha date not null,
  glosa text not null,
  status text not null default 'registrado',
  -- De dónde salió, en el gerencial. NULL = ajuste que sólo existe acá
  -- (una reclasificación tributaria, algo que no tiene espejo del otro lado).
  origen text,
  origen_id uuid,
  nota text,
  anulado_note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fiscal_comprobantes_status_check check (status in ('registrado','anulado')),
  constraint fiscal_comprobantes_origen_check
    check ((origen is null and origen_id is null)
        or (origen in ('venta','pago','egreso','comprobante') and origen_id is not null)),
  constraint fiscal_comprobantes_glosa_check check (btrim(glosa) <> '')
);

-- Un movimiento del gerencial se declara UNA vez. Si se anula, se puede
-- volver a importar: por eso el único mira sólo los vivos.
create unique index if not exists fiscal_comprobantes_origen_uidx
  on public.fiscal_comprobantes(origen, origen_id)
  where origen is not null and status = 'registrado';

create unique index if not exists fiscal_comprobantes_numero_uidx
  on public.fiscal_comprobantes(project_id, numero);

create index if not exists fiscal_comprobantes_fecha_idx
  on public.fiscal_comprobantes(project_id, fecha);

create table if not exists public.fiscal_lineas (
  id uuid primary key default gen_random_uuid(),
  comprobante_id uuid not null references public.fiscal_comprobantes(id) on delete cascade,
  account_code text not null references public.chart_of_accounts(code),
  debe numeric(14,2) not null default 0,
  haber numeric(14,2) not null default 0,
  glosa text,
  sort_order int not null default 0,
  constraint fiscal_lineas_signos_check check (debe >= 0 and haber >= 0)
);

create index if not exists fiscal_lineas_comprobante_idx
  on public.fiscal_lineas(comprobante_id);

-- Lo que se decide NO declarar, y por qué. Vive de este lado: el gerencial
-- no tiene por qué enterarse de que a algo suyo se lo dejó afuera.
create table if not exists public.fiscal_exclusiones (
  origen text not null,
  origen_id uuid not null,
  motivo text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (origen, origen_id),
  constraint fiscal_exclusiones_motivo_check check (btrim(motivo) <> '')
);

alter table public.fiscal_comprobantes enable row level security;
alter table public.fiscal_lineas       enable row level security;
alter table public.fiscal_exclusiones  enable row level security;

drop policy if exists fiscal_comprobantes_lee on public.fiscal_comprobantes;
create policy fiscal_comprobantes_lee on public.fiscal_comprobantes
  for select to authenticated using (private.is_team());
drop policy if exists fiscal_lineas_lee on public.fiscal_lineas;
create policy fiscal_lineas_lee on public.fiscal_lineas
  for select to authenticated using (private.is_team());
drop policy if exists fiscal_exclusiones_lee on public.fiscal_exclusiones;
create policy fiscal_exclusiones_lee on public.fiscal_exclusiones
  for select to authenticated using (private.is_team());

-- El candado de permisos, con su propia sección: se puede dar acceso al
-- gerencial sin dar acceso al fiscal, y al revés.
drop trigger if exists solo_lectura on public.fiscal_comprobantes;
create trigger solo_lectura before insert or update or delete on public.fiscal_comprobantes
  for each row execute function private.tg_solo_lectura('fiscal');
drop trigger if exists solo_lectura on public.fiscal_lineas;
create trigger solo_lectura before insert or update or delete on public.fiscal_lineas
  for each row execute function private.tg_solo_lectura('fiscal');
drop trigger if exists solo_lectura on public.fiscal_exclusiones;
create trigger solo_lectura before insert or update or delete on public.fiscal_exclusiones
  for each row execute function private.tg_solo_lectura('fiscal');

-- ---------- numeración propia ----------------------------------------------
create or replace function private.next_fiscal_number(p_project_id uuid, p_fecha date)
returns text
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select 'F-' || to_char(p_fecha, 'YYYY') || '-' ||
         lpad((coalesce(max(substring(numero from '\d+$')::int), 0) + 1)::text, 5, '0')
    from public.fiscal_comprobantes
   where project_id = p_project_id
     and numero like 'F-' || to_char(p_fecha, 'YYYY') || '-%';
$$;

-- ---------- el libro fiscal -------------------------------------------------
create or replace view public.v_fiscal_libro_diario as
select c.project_id, c.fecha, c.numero as comprobante,
       c.glosa || coalesce(' — ' || l.glosa, '') as glosa,
       l.account_code as cuenta, l.debe, l.haber,
       c.id as comprobante_id, c.origen, c.origen_id,
       c.origen is null as solo_fiscal
  from public.fiscal_comprobantes c
  join public.fiscal_lineas l on l.comprobante_id = c.id
 where c.status = 'registrado';

alter view public.v_fiscal_libro_diario set (security_invoker = true);

create or replace view public.v_fiscal_sumas_y_saldos as
select d.project_id, d.cuenta, coalesce(a.name, d.cuenta) as nombre, a.kind,
       round(sum(d.debe), 2)  as debe,
       round(sum(d.haber), 2) as haber,
       round(sum(d.debe) - sum(d.haber), 2) as saldo
  from public.v_fiscal_libro_diario d
  left join public.chart_of_accounts a on a.code = d.cuenta
 group by d.project_id, d.cuenta, a.name, a.kind;

alter view public.v_fiscal_sumas_y_saldos set (security_invoker = true);

-- Lo que el gerencial tiene y el fiscal todavía no: la cola de importación.
-- Un movimiento a nombre de un tercero aparece marcado, para que declararlo
-- sea una decisión y no un descuido.
create or replace view public.v_fiscal_pendiente as
select d.project_id, d.origen, d.origen_id,
       min(d.fecha) as fecha,
       min(d.comprobante) as comprobante,
       min(d.glosa) as glosa,
       max(d.cliente) as cliente,
       max(d.titular) as titular,
       max(d.titular_nombre) as titular_nombre,
       round(sum(d.debe), 2) as debe,
       round(sum(d.haber), 2) as haber,
       (x.origen is not null) as excluido,
       x.motivo as motivo_exclusion
  from public.v_libro_diario d
  left join public.fiscal_exclusiones x
         on x.origen = d.origen and x.origen_id = d.origen_id
 where not exists (
         select 1 from public.fiscal_comprobantes f
          where f.origen = d.origen and f.origen_id = d.origen_id
            and f.status = 'registrado')
 group by d.project_id, d.origen, d.origen_id, x.origen, x.motivo;

alter view public.v_fiscal_pendiente set (security_invoker = true);
