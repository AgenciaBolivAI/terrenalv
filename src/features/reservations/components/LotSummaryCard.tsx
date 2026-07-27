// Lot summary card — primitive props so both the RSC reserve page and the
// client tracking view can render it. No hooks: server-component friendly.

import { formatArea, formatMoney } from '@/lib/format';

export interface LotSummaryProps {
  manzana: string;
  lote: string;
  sector?: string | null;
  areaM2: number;
  frontageM?: number | null;
  depthM?: number | null;
  price?: number | null;
  currency?: 'USD' | 'BOB';
  amountDue?: number | null;
  amountDueCurrency?: 'USD' | 'BOB';
  title?: string;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-sm text-stone-500">{label}</dt>
      <dd className="text-right text-sm font-semibold text-stone-800">{value}</dd>
    </div>
  );
}

export function LotSummaryCard(props: LotSummaryProps) {
  const {
    manzana,
    lote,
    sector,
    areaM2,
    frontageM,
    depthM,
    price,
    currency = 'USD',
    amountDue,
    amountDueCurrency = 'BOB',
    title = 'Resumen del lote',
  } = props;

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-brand">
        {title}
      </h2>
      <p className="mb-2 text-lg font-bold text-stone-900">
        Manzana {manzana} · Lote {lote}
      </p>
      <dl className="divide-y divide-stone-100">
        {sector ? <Row label="Sector" value={sector} /> : null}
        <Row label="Superficie" value={formatArea(areaM2)} />
        {frontageM && depthM ? (
          <Row label="Frente × fondo" value={`${frontageM} m × ${depthM} m`} />
        ) : null}
        {typeof price === 'number' && price > 0 ? (
          <Row label="Precio del lote" value={formatMoney(price, currency)} />
        ) : null}
        {typeof amountDue === 'number' && amountDue > 0 ? (
          <div className="flex items-baseline justify-between gap-3 py-2">
            <dt className="text-sm font-semibold text-stone-700">Seña a pagar hoy</dt>
            <dd className="text-right text-base font-bold text-brand">
              {formatMoney(amountDue, amountDueCurrency)}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
