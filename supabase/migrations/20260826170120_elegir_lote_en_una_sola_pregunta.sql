-- Abrir "Vender en oficina" pedía el precio lote por lote: hasta 2.000
-- llamadas sueltas al servidor para llenar UNA lista. El navegador solo abre
-- unas seis conexiones a la vez, así que esas 2.000 llamadas se hacían en
-- tandas, una atrás de otra. El vendedor miraba una pantalla en blanco con el
-- cliente sentado enfrente.
--
-- El precio es la misma cuenta de lot_price() —override, o precio/m² por el
-- área— pero hecha para toda la lista de una vez.

create or replace view public.v_lotes_elegibles as
select
  l.id,
  l.project_id,
  l.number,
  l.area_m2,
  m.code                                                          as manzana,
  coalesce(l.price_override, round(pc.price_per_m2 * l.area_m2, 0)) as precio
from public.lots l
left join public.manzanas m on m.id = l.manzana_id
left join public.pricing_categories pc on pc.id = l.category_id
where l.status = 'disponible' and l.deleted_at is null;

alter view public.v_lotes_elegibles set (security_invoker = true);

-- Índices que faltaban en llaves foráneas. Sin ellos, borrar o actualizar la
-- fila padre obliga a recorrer la tabla hija entera para ver quién apuntaba.
create index if not exists commission_rules_profile_idx  on public.commission_rules(profile_id);
create index if not exists commission_rules_project_idx  on public.commission_rules(project_id);
create index if not exists contacts_created_by_idx       on public.contacts(created_by);
create index if not exists expenses_reservation_idx      on public.expenses(reservation_id);
create index if not exists fiscal_periods_closed_by_idx  on public.fiscal_periods(closed_by);
create index if not exists journal_entries_created_by_idx on public.journal_entries(created_by);
create index if not exists journal_entries_posted_by_idx on public.journal_entries(posted_by);
create index if not exists market_listings_fee_payment_idx on public.market_listings(fee_payment_id);
create index if not exists plano_jobs_created_by_idx     on public.plano_jobs(created_by);
create index if not exists plano_jobs_sheet_idx          on public.plano_jobs(sheet_id);
create index if not exists treasury_accounts_created_by_idx on public.treasury_accounts(created_by);

-- El que más se va a notar: v_comisiones y el pago de comisiones filtran
-- gastos por reserva Y categoría en la misma consulta.
create index if not exists expenses_comisiones_idx
  on public.expenses(reservation_id, category)
  where deleted_at is null;
