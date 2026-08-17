// Lot summary card — primitive props so both the RSC reserve page and the
// client tracking view can render it. No hooks: server-component friendly.

import type { FinancingBreakdown } from '@/lib/financing';
import { formatPct } from '@/lib/financing';
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
  /** Payment plan for this price. Null hides the rows entirely. */
  financing?: FinancingBreakdown | null;
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

/** The two numbers a buyer actually decides on: today's cash and the monthly. */
function HighlightRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="text-sm font-semibold text-stone-700">{label}</dt>
      <dd className="text-right text-base font-bold text-brand">{value}</dd>
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
    currency = 'BOB',
    amountDue,
    amountDueCurrency = 'BOB',
    financing,
    title = 'Resumen del lote',
  } = props;

  const hasPrice = typeof price === 'number' && price > 0;
  const plan = hasPrice ? (financing ?? null) : null;

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
        {hasPrice ? <Row label="Precio del lote" value={formatMoney(price, currency)} /> : null}

        {plan ? (
          <>
            <Row
              label={`Cuota inicial (${formatPct(plan.downPaymentPct)})`}
              value={formatMoney(plan.downPayment, currency)}
            />
            <HighlightRow
              label={plan.disclosesTerm ? `Cuota mensual (${plan.months} meses)` : 'Cuota mensual desde'}
              value={formatMoney(
                plan.monthly,
                plan.minMonthly !== null ? plan.downPaymentCurrency : currency,
              )}
            />
          </>
        ) : null}

        {typeof amountDue === 'number' && amountDue > 0 ? (
          <HighlightRow
            label="Seña a pagar hoy"
            value={formatMoney(amountDue, amountDueCurrency)}
          />
        ) : null}
      </dl>

      {plan ? (
        // With a quoted minimum the term is NOT published: it depends on terms
        // Terrenalv settles in person, so printing "N cuotas" here would be a
        // figure the closer has to walk back.
        <p className="mt-2 text-xs leading-relaxed text-stone-500">
          {plan.disclosesTerm
            ? `Saldo a financiar ${formatMoney(plan.financed, currency)} en ${plan.months} cuotas${
                plan.annualInterestPct > 0
                  ? `, interés ${formatPct(plan.annualInterestPct)} anual`
                  : ''
              }.`
            : 'El plazo se acuerda con tu asesor: tú propones tu forma de pago.'}
          {plan.note ? ` ${plan.note}` : ''}
        </p>
      ) : null}
    </section>
  );
}
