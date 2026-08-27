-- Dos preguntas que la contabilidad no sabía contestar:
--   «¿cuánto me costó el agua potable de la etapa 2?»  → centro de costos
--   «¿todo lo de este cliente, junto?»                 → cliente en cada línea
--
-- Y una tercera, que es la que abre la puerta a lo fiscal:
--   «¿a nombre de quién está esta transacción?»        → titular
--
-- El titular es un dato de la contabilidad de siempre, no del módulo fiscal:
-- saber a nombre de quién se compró algo sirve igual aunque no se declare
-- nada. Que después lo fiscal lo use para decidir qué declara es asunto de
-- lo fiscal — acá no se lo nombra.

create table if not exists public.centros_costo (
  id uuid primary key default gen_random_uuid(),
  -- null = centro de toda la empresa (oficina, administración central)
  project_id uuid references public.projects(id) on delete cascade,
  codigo text not null,
  nombre text not null,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint centros_costo_codigo_check check (btrim(codigo) <> ''),
  constraint centros_costo_nombre_check check (btrim(nombre) <> '')
);

create unique index if not exists centros_costo_codigo_uidx
  on public.centros_costo (
    coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(btrim(codigo)));

create index if not exists centros_costo_proyecto_idx
  on public.centros_costo(project_id) where is_active;

alter table public.centros_costo enable row level security;

drop policy if exists centros_costo_lee on public.centros_costo;
create policy centros_costo_lee on public.centros_costo
  for select to authenticated using (private.is_team());

-- La escritura pasa por RPC (assert_accounting) y por el candado de permisos.
drop trigger if exists solo_lectura on public.centros_costo;
create trigger solo_lectura before insert or update or delete on public.centros_costo
  for each row execute function private.tg_solo_lectura('contabilidad');

-- ---------- las dimensiones en las dos puntas donde se registra ------------
alter table public.expenses
  add column if not exists centro_costo_id uuid references public.centros_costo(id),
  add column if not exists titular text not null default 'empresa',
  add column if not exists titular_nombre text;

alter table public.journal_entries
  add column if not exists centro_costo_id uuid references public.centros_costo(id),
  add column if not exists reservation_id uuid references public.reservations(id),
  add column if not exists titular text not null default 'empresa',
  add column if not exists titular_nombre text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_titular_check') then
    alter table public.expenses add constraint expenses_titular_check
      check (titular in ('empresa','tercero'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'journal_entries_titular_check') then
    alter table public.journal_entries add constraint journal_entries_titular_check
      check (titular in ('empresa','tercero'));
  end if;
  -- Si es de un tercero, hay que decir de quién: «a nombre de un tercero» sin
  -- nombre no le sirve a nadie el día que haya que explicarlo.
  if not exists (select 1 from pg_constraint where conname = 'expenses_tercero_con_nombre') then
    alter table public.expenses add constraint expenses_tercero_con_nombre
      check (titular <> 'tercero' or btrim(coalesce(titular_nombre,'')) <> '');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'journal_entries_tercero_con_nombre') then
    alter table public.journal_entries add constraint journal_entries_tercero_con_nombre
      check (titular <> 'tercero' or btrim(coalesce(titular_nombre,'')) <> '');
  end if;
end $$;

create index if not exists expenses_centro_costo_idx on public.expenses(centro_costo_id)
  where deleted_at is null;
create index if not exists journal_entries_centro_costo_idx on public.journal_entries(centro_costo_id);
create index if not exists journal_entries_reservation_idx on public.journal_entries(reservation_id);
