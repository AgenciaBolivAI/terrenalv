-- INVENTARIO DE TERRENOS — el agujero más grande que tenía esta contabilidad.
--
-- Hasta hoy el sistema registraba la VENTA de un lote (4111) y nunca su
-- COSTO. Un estado de resultados con ingresos y sin costo de lo vendido no
-- es un estado de resultados: es una lista de cobros. Prados del Sur tiene
-- 2.078 lotes con precios de lista por Bs 82 millones y el sistema no sabía
-- cuánto había costado ese terreno.
--
-- Cómo funciona:
--   · Se compra un terreno madre (superficie y precio). Eso NO es gasto: es
--     mercadería. Va al inventario (1151).
--   · Los costos de urbanización —caminos, agua, luz— pueden CAPITALIZAR:
--     en vez de golpear el resultado del mes, engordan el inventario. Se
--     marca por centro de costos.
--   · El costo por m² sale de dividir el inventario entre los m² vendibles.
--     Se puede fijar un costo presupuestado por m² para que el margen no
--     salte según cuándo se cargó cada obra.
--   · Al vender un lote, la parte que le toca sale del inventario y se
--     vuelve costo de ventas (5121). Recién ahí hay margen bruto de verdad.
--
-- El costo se mide A LA FECHA DE LA VENTA: sólo cuentan las compras y obras
-- anteriores a ese día. Así una obra nueva no reescribe el costo de una
-- venta de hace dos años, que además caería en una gestión ya cerrada.

insert into public.chart_of_accounts (code, name, kind, sort_order, is_active, is_system)
values
  ('1151', 'Inventario de Terrenos',        'activo', 151, true, true),
  ('5121', 'Costo de Ventas de Terrenos',   'gasto',  512, true, true)
on conflict (code) do nothing;

create table if not exists public.land_parcels (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  codigo text not null,
  nombre text not null,
  superficie_m2 numeric(14,2) not null,
  costo_compra numeric(14,2) not null,
  fecha_compra date not null,
  vendedor_contact_id uuid references public.contacts(id),
  vendedor_nombre text,
  documento text,
  -- Costo presupuestado por m² del proyecto terminado. Si se carga, manda
  -- este y el margen deja de saltar según cuándo se pagó cada obra.
  costo_m2_presupuestado numeric(14,4),
  treasury_account_id uuid references public.treasury_accounts(id),
  titular text not null default 'empresa',
  titular_nombre text,
  nota text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint land_parcels_sup_check check (superficie_m2 > 0),
  constraint land_parcels_costo_check check (costo_compra >= 0),
  constraint land_parcels_codigo_check check (btrim(codigo) <> ''),
  constraint land_parcels_titular_check check (titular in ('empresa','tercero')),
  constraint land_parcels_tercero_check
    check (titular <> 'tercero' or btrim(coalesce(titular_nombre,'')) <> '')
);

create unique index if not exists land_parcels_codigo_uidx
  on public.land_parcels (lower(btrim(codigo)));
create index if not exists land_parcels_proyecto_idx on public.land_parcels(project_id);

alter table public.land_parcels enable row level security;
drop policy if exists land_parcels_lee on public.land_parcels;
create policy land_parcels_lee on public.land_parcels
  for select to authenticated using (private.is_team());
drop trigger if exists solo_lectura on public.land_parcels;
create trigger solo_lectura before insert or update or delete on public.land_parcels
  for each row execute function private.tg_solo_lectura('inventario');

-- Un centro de costos puede capitalizar: lo que se carga ahí no es gasto del
-- mes, es plata que engorda el lote.
alter table public.centros_costo
  add column if not exists capitaliza boolean not null default false;

comment on column public.centros_costo.capitaliza is
  'true = lo cargado acá capitaliza al inventario de terrenos (1151) en vez '
  'de irse como gasto del mes. Caminos, agua, luz, topografía.';

-- ---------- el costo por m², a una fecha -----------------------------------
create or replace function private.costo_m2(p_project_id uuid, p_fecha date)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
           -- Si hay presupuesto cargado, manda: el margen no depende de
           -- cuándo se pagó cada obra.
           when max(pp.costo_m2_presupuestado) is not null
             then max(pp.costo_m2_presupuestado)
           when coalesce(max(m2.total), 0) > 0
             then round((coalesce(max(pp.compras), 0) + coalesce(max(ob.obras), 0))
                        / max(m2.total), 4)
           else 0
         end
    from (select 1) _
    cross join lateral (
      select sum(lp.costo_compra) as compras,
             max(lp.costo_m2_presupuestado) as costo_m2_presupuestado
        from public.land_parcels lp
       where lp.project_id = p_project_id and lp.fecha_compra <= p_fecha) pp
    cross join lateral (
      select sum(e.amount_bob) as obras
        from public.expenses e
        join public.centros_costo cc on cc.id = e.centro_costo_id
       where e.project_id = p_project_id and e.deleted_at is null
         and cc.capitaliza and e.incurred_on <= p_fecha) ob
    cross join lateral (
      select sum(l.area_m2) as total
        from public.lots l
       where l.project_id = p_project_id and l.deleted_at is null) m2;
$$;

revoke all on function private.costo_m2(uuid, date) from public, anon, authenticated;

-- ---------- el tablero: ¿los precios cubren el costo? ----------------------
create or replace view public.v_inventario_terrenos as
select p.id as project_id,
       p.name as proyecto,
       coalesce(pa.parcelas, 0)        as parcelas,
       coalesce(pa.superficie_m2, 0)   as superficie_comprada_m2,
       coalesce(pa.costo_compra, 0)    as costo_compra,
       coalesce(ob.obras, 0)           as obras_capitalizadas,
       coalesce(pa.costo_compra, 0) + coalesce(ob.obras, 0) as costo_total,
       coalesce(lo.lotes, 0)           as lotes,
       coalesce(lo.m2_vendibles, 0)    as m2_vendibles,
       coalesce(lo.precio_lista, 0)    as suma_precios_lista,
       pa.costo_m2_presupuestado,
       case when coalesce(lo.m2_vendibles, 0) > 0
            then round((coalesce(pa.costo_compra,0) + coalesce(ob.obras,0)) / lo.m2_vendibles, 4)
            else 0 end                 as costo_m2,
       case when coalesce(lo.m2_vendibles, 0) > 0
            then round(coalesce(lo.precio_lista,0) / lo.m2_vendibles, 2)
            else 0 end                 as precio_m2_promedio,
       coalesce(lo.precio_lista, 0)
         - (coalesce(pa.costo_compra, 0) + coalesce(ob.obras, 0)) as margen_potencial,
       case when coalesce(lo.precio_lista, 0) > 0
            then round((coalesce(lo.precio_lista,0)
                        - (coalesce(pa.costo_compra,0) + coalesce(ob.obras,0)))
                       / lo.precio_lista * 100, 1)
            else null end              as margen_pct,
       -- La alarma que pidieron: si los precios no cubren el costo, se vende
       -- a pérdida y hay que enterarse antes, no al cerrar la gestión.
       (coalesce(lo.precio_lista, 0)
        < coalesce(pa.costo_compra, 0) + coalesce(ob.obras, 0)) as no_cubre_el_costo,
       coalesce(vd.vendidos, 0)        as lotes_vendidos,
       coalesce(vd.m2_vendidos, 0)     as m2_vendidos,
       coalesce(vd.costo_vendido, 0)   as costo_de_lo_vendido,
       coalesce(pa.costo_compra, 0) + coalesce(ob.obras, 0)
         - coalesce(vd.costo_vendido, 0) as inventario_en_libros
  from public.projects p
  left join lateral (
    select count(*) as parcelas, sum(lp.superficie_m2) as superficie_m2,
           sum(lp.costo_compra) as costo_compra,
           max(lp.costo_m2_presupuestado) as costo_m2_presupuestado
      from public.land_parcels lp where lp.project_id = p.id) pa on true
  left join lateral (
    select sum(e.amount_bob) as obras
      from public.expenses e
      join public.centros_costo cc on cc.id = e.centro_costo_id
     where e.project_id = p.id and e.deleted_at is null and cc.capitaliza) ob on true
  left join lateral (
    select count(*) as lotes, sum(l.area_m2) as m2_vendibles,
           sum(coalesce(l.price_override, pc.price_per_m2 * l.area_m2)) as precio_lista
      from public.lots l
      left join public.pricing_categories pc on pc.id = l.category_id
     where l.project_id = p.id and l.deleted_at is null) lo on true
  left join lateral (
    select count(*) as vendidos, sum(l.area_m2) as m2_vendidos,
           sum(round(l.area_m2 * private.costo_m2(r.project_id,
                 (r.confirmed_at at time zone 'America/La_Paz')::date), 2)) as costo_vendido
      from public.reservations r
      join public.lots l on l.id = r.lot_id
     where r.project_id = p.id and r.status = 'confirmada' and r.confirmed_at is not null) vd on true
 where p.status <> 'archivado';

alter view public.v_inventario_terrenos set (security_invoker = true);
