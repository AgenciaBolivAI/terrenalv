-- Conceptos de egreso: un catálogo, no una lista cerrada en el código.
--
-- Hasta hoy la categoría era un enum de siete valores. «Uniformes», «luz»,
-- «alquiler» o «combustible» no tenían dónde caer y terminaban todos en
-- «administración», que es como no clasificar nada. Cambiar el enum exige
-- una migración cada vez; un catálogo lo maneja el contador solo.
--
-- La idea es la misma que la de hr_payroll_concepts en totalpec: código,
-- nombre, a qué cuenta pega, y activo/inactivo. Cada concepto sabe en qué
-- cuenta del plan cae, así que agregar uno no toca el libro.

create table if not exists public.expense_concepts (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  nombre text not null,
  -- La familia de siempre: lo que ya entiende el resto del sistema.
  categoria expense_category not null,
  -- La cuenta del plan donde cae. Si se deja vacía, manda la de la familia.
  account_code text references public.chart_of_accounts(code),
  ayuda text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expense_concepts_codigo_check check (btrim(codigo) <> ''),
  constraint expense_concepts_nombre_check check (btrim(nombre) <> '')
);

create unique index if not exists expense_concepts_codigo_uidx
  on public.expense_concepts (lower(btrim(codigo)));

create index if not exists expense_concepts_activos_idx
  on public.expense_concepts (categoria, sort_order) where is_active;

alter table public.expense_concepts enable row level security;

drop policy if exists expense_concepts_lee on public.expense_concepts;
create policy expense_concepts_lee on public.expense_concepts
  for select to authenticated using (private.is_team());

drop trigger if exists solo_lectura on public.expense_concepts;
create trigger solo_lectura before insert or update or delete on public.expense_concepts
  for each row execute function private.tg_solo_lectura('contabilidad');

alter table public.expenses
  add column if not exists concept_id uuid references public.expense_concepts(id);

create index if not exists expenses_concepto_idx on public.expenses(concept_id)
  where deleted_at is null;

-- ---------- El catálogo de arranque -----------------------------------------
-- Lo que ya se usaba, más lo que faltaba y se pedía a mano.
insert into public.expense_concepts (codigo, nombre, categoria, account_code, ayuda, sort_order)
values
  -- Obra
  ('OBRA-MAT',  'Materiales de obra',        'obra',          '5111', 'Cemento, áridos, tubería, fierro.', 10),
  ('OBRA-MO',   'Mano de obra',              'obra',          '5111', 'Cuadrillas y contratistas de obra.', 20),
  ('OBRA-MAQ',  'Maquinaria y equipo',       'obra',          '5111', 'Alquiler de volquetas, retroexcavadora.', 30),
  -- Personal
  ('PER-SUE',   'Sueldos',                   'sueldos',       '5221', 'Planilla del personal.', 40),
  ('PER-CS',    'Cargas sociales',           'sueldos',       '5221', 'Aportes patronales, AFP, seguro.', 50),
  ('PER-AGUI',  'Aguinaldos y bonos',        'sueldos',       '5221', 'Aguinaldo, bono de producción.', 60),
  ('PER-UNIF',  'Uniformes y ropa de trabajo','sueldos',      '5221', 'Uniformes, botas, cascos, chalecos.', 70),
  ('PER-CAP',   'Capacitación',              'sueldos',       '5221', 'Cursos y formación del equipo.', 80),
  ('PER-VIAT',  'Viáticos y movilidad',      'sueldos',       '5221', 'Pasajes, viáticos, refrigerios.', 90),
  -- Servicios básicos y oficina
  ('SB-LUZ',    'Luz',                       'administracion','5411', 'Energía eléctrica.', 100),
  ('SB-AGUA',   'Agua',                      'administracion','5411', 'Agua potable.', 110),
  ('SB-INT',    'Internet y teléfono',       'administracion','5411', 'Internet, telefonía, datos.', 120),
  ('OF-ALQ',    'Alquiler de oficina',       'administracion','5411', 'Alquiler del local u oficina.', 130),
  ('OF-PAP',    'Papelería y útiles',        'administracion','5411', 'Insumos de oficina, impresiones.', 140),
  ('OF-LIMP',   'Limpieza e insumos',        'administracion','5411', 'Artículos y servicio de limpieza.', 150),
  ('OF-MANT',   'Mantenimiento y reparaciones','administracion','5411','Arreglos de oficina y equipos.', 160),
  ('OP-COMB',   'Combustible',               'administracion','5411', 'Gasolina y diésel de vehículos.', 170),
  ('OP-VEH',    'Vehículos: mantenimiento y seguro','administracion','5411','Service, llantas, seguro.', 180),
  ('OP-SEG',    'Seguros',                   'administracion','5411', 'Pólizas de la empresa.', 190),
  ('OP-HON',    'Honorarios profesionales',  'administracion','5411', 'Abogados, contadores, consultores.', 200),
  ('OP-SOFT',   'Software y servicios en línea','administracion','5411','Licencias, hosting, suscripciones.', 210),
  -- Comercial
  ('COM-PUB',   'Publicidad',                'publicidad',    '5311', 'Pauta, cartelería, redes.', 220),
  ('COM-EVE',   'Eventos y ferias',          'publicidad',    '5311', 'Stands, ferias, activaciones.', 230),
  ('COM-COMI',  'Comisiones de venta',       'comisiones',    '5211', 'Comisiones a los asesores.', 240),
  -- Impuestos y financiero
  ('IMP-IMP',   'Impuestos y tasas',         'impuestos',     '5511', 'IVA, IT, IUE, patentes municipales.', 250),
  ('FIN-BAN',   'Gastos bancarios',          'financiero',    '5611', 'Mantenimiento de cuenta, comisiones.', 260),
  ('FIN-INT',   'Intereses de préstamos',    'financiero',    '5611', 'Intereses pagados por deuda.', 270),
  -- El cajón de sastre, que existe pero se ve
  ('OTR-VAR',   'Otros gastos',              'otros',         '5911', 'Lo que no encaja en ningún concepto.', 999)
on conflict do nothing;
