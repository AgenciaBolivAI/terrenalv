// Plan de pago: cuota inicial + cuota mensual.
//
// Pure functions, no imports — the same numbers must appear on the map sheet
// (client), on the reserve page (RSC) and in the admin preview. Two code paths
// computing "la cuota" differently is how a buyer ends up quoted one figure on
// screen and another in the office.
//
// This is a DISPLAY calculation. It does not create installments, schedules or
// balances; `payments.purpose = 'cuota'` exists for that and is still v2.

export interface FinancingPlan {
  enabled: boolean;
  down_payment_type: 'porcentaje' | 'fijo';
  /** Percentage of the price, or a fixed amount in the project's currency. */
  down_payment_value: number;
  months: number;
  annual_interest_pct: number;
  note: string | null;
}

export interface FinancingBreakdown {
  downPayment: number;
  /** Always derived, so a fixed down payment still reads as "(30%)". */
  downPaymentPct: number;
  financed: number;
  months: number;
  monthly: number;
  annualInterestPct: number;
  totalPaid: number;
  note: string | null;
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

  return {
    enabled: true,
    down_payment_type: type,
    down_payment_value: value,
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
): FinancingBreakdown | null {
  if (!plan) return null;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;

  const rawDown =
    plan.down_payment_type === 'porcentaje'
      ? (price * plan.down_payment_value) / 100
      : plan.down_payment_value;

  const downPayment = round2(Math.min(rawDown, price));
  const financed = round2(price - downPayment);
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
    downPaymentPct: round2((downPayment / price) * 100),
    financed,
    months: plan.months,
    monthly,
    annualInterestPct: plan.annual_interest_pct,
    totalPaid: round2(downPayment + monthly * plan.months),
    note: plan.note,
  };
}

/** "30 %" / "27,5 %" — es-BO, at most one decimal. */
export function formatPct(pct: number): string {
  return `${new Intl.NumberFormat('es-BO', { maximumFractionDigits: 1 }).format(pct)}%`;
}
