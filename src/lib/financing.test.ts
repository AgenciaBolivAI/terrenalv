import { describe, expect, it } from 'vitest';
import { computeFinancing, formatPct, formatTerm, parseFinancingPlan } from './financing';

const PLAN = {
  enabled: true,
  down_payment_type: 'porcentaje',
  down_payment_value: 30,
  months: 36,
  annual_interest_pct: 0,
  note: 'Plan referencial.',
};

describe('parseFinancingPlan', () => {
  it('accepts a well formed plan', () => {
    expect(parseFinancingPlan(PLAN)).toEqual({
      enabled: true,
      down_payment_type: 'porcentaje',
      down_payment_value: 30,
      down_payment_currency: undefined,
      months: 36,
      annual_interest_pct: 0,
      note: 'Plan referencial.',
    });
  });

  it('treats a disabled plan as absent', () => {
    expect(parseFinancingPlan({ ...PLAN, enabled: false })).toBeNull();
  });

  it.each([
    ['null', null],
    ['an array', [PLAN]],
    ['a missing type', { ...PLAN, down_payment_type: undefined }],
    ['an unknown type', { ...PLAN, down_payment_type: 'cuotas' }],
    ['a zero down payment', { ...PLAN, down_payment_value: 0 }],
    ['a percentage over 100', { ...PLAN, down_payment_value: 120 }],
    ['zero months', { ...PLAN, months: 0 }],
    ['non-numeric months', { ...PLAN, months: '36' }],
  ])('rejects %s', (_label, raw) => {
    expect(parseFinancingPlan(raw)).toBeNull();
  });

  it('drops a negative interest rate instead of failing', () => {
    expect(parseFinancingPlan({ ...PLAN, annual_interest_pct: -5 })?.annual_interest_pct).toBe(0);
  });

  it('blank notes become null, not an empty line in the UI', () => {
    expect(parseFinancingPlan({ ...PLAN, note: '   ' })?.note).toBeNull();
  });
});

describe('computeFinancing', () => {
  const plan = parseFinancingPlan(PLAN)!;

  it('splits a price into down payment and interest-free installments', () => {
    // The card in the screenshot: Manzana M-5 · Lote 34 at $us 8.745.
    const r = computeFinancing(8745, plan)!;
    expect(r.downPayment).toBe(2623.5);
    expect(r.financed).toBe(6121.5);
    expect(r.months).toBe(36);
    // 6.121,50 / 36 = 170,041… → rounded up so the term covers the balance.
    expect(r.monthly).toBe(170.05);
    expect(r.downPaymentPct).toBe(30);
  });

  it('derives the percentage when the down payment is a fixed amount', () => {
    const fixed = parseFinancingPlan({
      ...PLAN,
      down_payment_type: 'fijo',
      down_payment_value: 2000,
    })!;
    const r = computeFinancing(8000, fixed)!;
    expect(r.downPayment).toBe(2000);
    expect(r.downPaymentPct).toBe(25);
    expect(r.monthly).toBe(166.67);
  });

  it('amortizes when a rate is set', () => {
    const withInterest = parseFinancingPlan({ ...PLAN, annual_interest_pct: 12, months: 12 })!;
    const r = computeFinancing(10000, withInterest)!;
    // 7.000 at 1 %/month over 12 months = 621,9415… → rounded up.
    expect(r.monthly).toBe(621.95);
    expect(r.totalPaid).toBeGreaterThan(10000);
  });

  it('never advertises installments that leave a balance owing', () => {
    // 7.500 → 5.250 financed / 36 = 145,8333…; 36 × 145,83 falls 12 ctvs short.
    for (const price of [7500, 8745, 9000, 6333, 12345.67]) {
      const r = computeFinancing(price, plan)!;
      expect(r.monthly * r.months).toBeGreaterThanOrEqual(r.financed);
      // …and never by more than one cent per installment.
      expect(r.monthly * r.months - r.financed).toBeLessThan(r.months * 0.01);
    }
  });

  it('an exact division is not nudged up a cent', () => {
    // 1.080 with 50 % down = 540 financed / 36 = 15,00 exactly.
    // Float noise must not turn that into 15,01.
    const half = parseFinancingPlan({ ...PLAN, down_payment_value: 50 })!;
    expect(computeFinancing(1080, half)!.monthly).toBe(15);
  });

  it.each([
    ['no plan', 7500, null],
    ['a zero price', 0, plan],
    ['a negative price', -100, plan],
    ['a null price', null, plan],
  ])('shows nothing for %s', (_label, price, p) => {
    expect(computeFinancing(price, p)).toBeNull();
  });

  it('shows nothing when the down payment already covers the lot', () => {
    const full = parseFinancingPlan({ ...PLAN, down_payment_value: 100 })!;
    expect(computeFinancing(7500, full)).toBeNull();
  });

  it('caps a fixed down payment larger than the lot instead of going negative', () => {
    const huge = parseFinancingPlan({
      ...PLAN,
      down_payment_type: 'fijo',
      down_payment_value: 99999,
    })!;
    expect(computeFinancing(7500, huge)).toBeNull();
  });
});

describe('formatPct', () => {
  it('uses es-BO decimals and drops trailing zeros', () => {
    expect(formatPct(30)).toBe('30%');
    expect(formatPct(27.5)).toBe('27,5%');
  });
});

describe('cuota inicial in a different currency to the price', () => {
  // Terrenalv quotes lots in $us but the entry payment in bolivianos.
  const bs500 = parseFinancingPlan({
    ...PLAN,
    down_payment_type: 'fijo',
    down_payment_value: 500,
    down_payment_currency: 'BOB',
    months: 120,
  })!;

  it('converts before subtracting from a $us price', () => {
    const r = computeFinancing(9000, bs500, { currency: 'USD', bobPerUsd: 6.96 })!;
    expect(r.downPayment).toBe(500);            // shown as Bs 500
    expect(r.downPaymentCurrency).toBe('BOB');
    expect(r.downPaymentInPrice).toBe(71.84);   // 500 / 6.96
    expect(r.financed).toBe(8928.16);
    expect(r.monthly).toBe(74.41);              // 8928.16 / 120, rounded up
    expect(r.months).toBe(120);
  });

  it('never treats Bs 500 as $us 500', () => {
    const wrong = computeFinancing(9000, bs500, { currency: 'USD', bobPerUsd: 6.96 })!;
    expect(wrong.financed).not.toBe(8500);
  });

  it('a percentage stays in the price currency whatever the field says', () => {
    const pct = parseFinancingPlan({ ...PLAN, down_payment_currency: 'BOB' })!;
    const r = computeFinancing(9000, pct, { currency: 'USD', bobPerUsd: 6.96 })!;
    expect(r.downPaymentCurrency).toBe('USD');
    expect(r.downPayment).toBe(2700);
  });
});

describe('formatTerm', () => {
  it('reads long plans as years', () => {
    expect(formatTerm(120)).toBe('10 años');
    expect(formatTerm(36)).toBe('3 años');
    expect(formatTerm(30)).toBe('2 años y 6 meses');
    expect(formatTerm(12)).toBe('12 meses');
  });
});
