// Plan de pago: cuota inicial + cuota mensual.
//
// Pure functions, no imports — the same numbers must appear on the map sheet
// (client), on the reserve page (RSC) and in the admin preview. Two code paths
// computing "la cuota" differently is how a buyer ends up quoted one figure on
// screen and another in the office.
//
// This is a DISPLAY calculation. It does not create installments, schedules or
// balances; `payments.purpose = 'cuota'` exists for that and is still v2.

export type Currency = 'USD' | 'BOB';

export interface FinancingPlan {
  enabled: boolean;
  down_payment_type: 'porcentaje' | 'fijo';
  /** Percentage of the price, or a fixed amount in down_payment_currency. */
  down_payment_value: number;
  /**
   * Currency of a FIXED down payment. Terrenalv quotes lots in $us but the
   * entry payment in bolivianos ("cuota inicial 500 Bs"), so the two are not
   * necessarily the same unit and the amount has to be converted before it can
   * be subtracted from the price. Defaults to the project currency.
   */
  down_payment_currency?: Currency;
  months: number;
  annual_interest_pct: number;
  note: string | null;
}

export interface FinancingBreakdown {
  /** As the seller quotes it — may be in a different currency to the price. */
  downPayment: number;
  downPaymentCurrency: Currency;
  /** The same amount expressed in the price's currency, for the arithmetic. */
  downPaymentInPrice: number;
  /** Always derived, so a fixed down payment still reads as "(30%)". */
  downPaymentPct: number;
  financed: number;
  months: number;
  monthly: number;
  annualInterestPct: number;
  totalPaid: number;
  note: string | null;
}

/** Default only — the live rate lives in settings.exchange_rate_bob_per_usd. */
export const DEFAULT_BOB_PER_USD = 6.96;

export interface FinancingContext {
  /** Currency the lot price is expressed in. */
  currency?: Currency;
  /** Bs per $us, from settings.exchange_rate_bob_per_usd. */
  bobPerUsd?: number;
}

function convert(amount: number, from: Currency, to: Currency, bobPerUsd: number): number {
  if (from === to) return amount;
  return from === 'BOB' ? amount / bobPerUsd : amount * bobPerUsd;
}

/** Money is rounded to cents at every step; the buyer sees the same figures. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Installments round UP to the cent. Dividing a balance by a term rarely lands
 * on a whole cent (5.250 / 36 = 145,8333…), and rounding down advertises a
 * payment that never clears the debt — 36 × 145,83 leaves 12 centavos owing.
 * Up means the term is always covered and the final installment is the one that
 * comes in slightly smaller, which is how the office settles it anyway.
 */
function ceil2(n: number): number {
  // Round away float noise first, or 150.00000000000003 would tick to 150,01.
  return Math.ceil(Math.round(n * 100 * 1e6) / 1e6) / 100;
}

/**
 * Validate the `financing_plan` setting coming from the database. Returns null
 * for anything unusable so a malformed row degrades to "no plan shown" rather
 * than to a wrong price on a public page.
 */
export function parseFinancingPlan(raw: unknown): FinancingPlan | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;

  if (p.enabled !== true) return null;

  const type = p.down_payment_type;
  if (type !== 'porcentaje' && type !== 'fijo') return null;

  const value = p.down_payment_value;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  if (type === 'porcentaje' && value > 100) return null;

  const months = p.months;
  if (typeof months !== 'number' || !Number.isFinite(months) || months < 1) return null;

  const interest =
    typeof p.annual_interest_pct === 'number' &&
    Number.isFinite(p.annual_interest_pct) &&
    p.annual_interest_pct > 0
      ? p.annual_interest_pct
      : 0;

  const note = typeof p.note === 'string' && p.note.trim() ? p.note.trim() : null;

  const dpc = p.down_payment_currency;
  const down_payment_currency: Currency | undefined =
    dpc === 'BOB' || dpc === 'USD' ? dpc : undefined;

  return {
    enabled: true,
    down_payment_type: type,
    down_payment_value: value,
    down_payment_currency,
    months: Math.floor(months),
    annual_interest_pct: interest,
    note,
  };
}

/**
 * Split a lot price into what is paid up front and what is paid monthly.
 * Interest-free is the common case in Bolivian land sales, so `monthly` is a
 * plain division; with a rate it is the standard amortized payment.
 *
 * Returns null when there is nothing to show (no plan, no price, or a down
 * payment that already covers the lot).
 */
export function computeFinancing(
  price: number | null | undefined,
  plan: FinancingPlan | null,
  ctx: FinancingContext = {},
): FinancingBreakdown | null {
  if (!plan) return null;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;

  const priceCurrency: Currency = ctx.currency ?? 'USD';
  const bobPerUsd = ctx.bobPerUsd && ctx.bobPerUsd > 0 ? ctx.bobPerUsd : DEFAULT_BOB_PER_USD;
  // A percentage is of the price, so it is always in the price's currency.
  const downCurrency: Currency =
    plan.down_payment_type === 'porcentaje'
      ? priceCurrency
      : (plan.down_payment_currency ?? priceCurrency);

  const rawDown =
    plan.down_payment_type === 'porcentaje'
      ? (price * plan.down_payment_value) / 100
      : plan.down_payment_value;

  // Convert before comparing with the price — Bs 500 is not $us 500.
  const rawDownInPrice = convert(rawDown, downCurrency, priceCurrency, bobPerUsd);
  const downPaymentInPrice = round2(Math.min(rawDownInPrice, price));
  // Show the figure the seller actually quotes. Converting back from the
  // rounded price-currency amount turned "Bs 500" into "Bs 500,01"; only a
  // down payment clamped by the price needs re-deriving.
  const downPayment =
    rawDownInPrice <= price
      ? round2(rawDown)
      : round2(convert(price, priceCurrency, downCurrency, bobPerUsd));

  const financed = round2(price - downPaymentInPrice);
  // Paid in full up front: there is no monthly payment to advertise.
  if (financed <= 0) return null;

  const monthlyRate = plan.annual_interest_pct / 100 / 12;
  const monthly = ceil2(
    monthlyRate > 0
      ? (financed * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -plan.months))
      : financed / plan.months,
  );

  return {
    downPayment,
    downPaymentCurrency: downCurrency,
    downPaymentInPrice,
    downPaymentPct: round2((downPaymentInPrice / price) * 100),
    financed,
    months: plan.months,
    monthly,
    annualInterestPct: plan.annual_interest_pct,
    totalPaid: round2(downPaymentInPrice + monthly * plan.months),
    note: plan.note,
  };
}

/** "10 años", "5 años y 6 meses", "36 meses" — 120 months should not read as 120. */
export function formatTerm(months: number): string {
  if (months < 24) return `${months} meses`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  const years = `${y} ${y === 1 ? 'año' : 'años'}`;
  return m === 0 ? years : `${years} y ${m} ${m === 1 ? 'mes' : 'meses'}`;
}

/** "30 %" / "27,5 %" — es-BO, at most one decimal. */
export function formatPct(pct: number): string {
  return `${new Intl.NumberFormat('es-BO', { maximumFractionDigits: 1 }).format(pct)}%`;
}
