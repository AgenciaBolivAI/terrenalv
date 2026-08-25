import { describe, expect, it } from 'vitest';
import {
  computeFinancing,
  cuotaDelPlan,
  formatPct,
  formatTerm,
  mesesDelPlan,
  parseFinancingPlan,
} from './financing';

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

  it('amortizes when a rate is set — the rate is MONTHLY', () => {
    // La tasa guardada es MENSUAL sobre saldo: 1 = 1% al mes. Antes esto se
    // dividía entre 12 tratándola como anual, así que la vitrina publicaba
    // una cuota que la oficina después contradecía.
    const withInterest = parseFinancingPlan({ ...PLAN, annual_interest_pct: 1, months: 12 })!;
    const r = computeFinancing(10000, withInterest)!;
    // 7.000 al 1 % mensual en 12 meses = 621,9415… → 621,94, redondeo normal.
    // Con interés NO se redondea hacia arriba: la última cuota absorbe la
    // diferencia, y así lo hace la base al generar el cronograma. Si la
    // vitrina redondeara distinto, publicaría un centavo que el contrato no
    // dice.
    expect(r.monthly).toBe(621.94);
    expect(r.monthly).toBe(cuotaDelPlan(7000, 1, 12));
    expect(r.totalPaid).toBeGreaterThan(10000);
  });

  it('el 2 % mensual de Terrenalv sobre un lote típico', () => {
    // Mismo caso que la venta real: la vitrina y el plan firmado tienen que
    // decir la misma cuota.
    const dosPorCiento = parseFinancingPlan({
      ...PLAN,
      down_payment_type: 'fijo',
      down_payment_value: 500,
      annual_interest_pct: 2,
      months: 120,
    })!;
    const r = computeFinancing(42800, dosPorCiento)!;
    expect(r.financed).toBe(42300);
    expect(r.monthly).toBe(cuotaDelPlan(42300, 2, 120));
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

describe('a quoted minimum monthly suppresses the term', () => {
  // Terrenalv publishes "cuota inicial Bs 500, cuota mensual desde Bs 817" and
  // settles the term in person, because it depends on interest they do not
  // disclose online. Deriving "N cuotas" would contradict the closer.
  const quoted = parseFinancingPlan({
    enabled: true,
    down_payment_type: 'fijo',
    down_payment_value: 500,
    down_payment_currency: 'BOB',
    min_monthly: 817,
    months: 120,
    annual_interest_pct: 0,
    note: null,
  })!;

  it('publishes the quoted minimum, not the computed installment', () => {
    const r = computeFinancing(24800, quoted, { currency: 'BOB' })!;
    // 24.300 / 120 would be Bs 202,50 — never shown.
    expect(r.monthly).toBe(817);
    expect(r.minMonthly).toBe(817);
    expect(r.disclosesTerm).toBe(false);
  });

  it('still discloses the term when no minimum is set', () => {
    const computed = parseFinancingPlan({ ...PLAN, months: 36 })!;
    const r = computeFinancing(24800, computed, { currency: 'BOB' })!;
    expect(r.minMonthly).toBeNull();
    expect(r.disclosesTerm).toBe(true);
    expect(r.monthly).toBeLessThan(817);
  });
});

// Las cifras de abajo NO son inventadas: salieron de correr el RPC real contra
// la base (en transacciones abortadas) y anotar lo que devolvió. Si alguien
// toca la fórmula de un lado y no del otro, esta prueba lo caza antes de que
// un comprador vea una cuota en pantalla y otra en su contrato.
describe('cuotaDelPlan — misma cuenta que la base', () => {
  it('120 cuotas de Bs 42.300 al 2% mensual', () => {
    expect(cuotaDelPlan(42300, 2, 120)).toBe(932.63);
  });

  it('24 cuotas de Bs 25.500 al 1,5% mensual', () => {
    expect(cuotaDelPlan(25500, 1.5, 24)).toBe(1273.06);
  });

  it('12 cuotas de Bs 24.000 al 1,5% mensual', () => {
    expect(cuotaDelPlan(24000, 1.5, 12)).toBe(2200.32);
  });

  it('sin interés divide y redondea al centavo hacia arriba', () => {
    expect(cuotaDelPlan(42300, 0, 120)).toBe(352.5);
    expect(cuotaDelPlan(5250, 0, 36)).toBe(145.84);
  });

  it('devuelve 0 cuando no hay nada que financiar', () => {
    expect(cuotaDelPlan(0, 2, 120)).toBe(0);
    expect(cuotaDelPlan(42300, 2, 0)).toBe(0);
  });
});

describe('mesesDelPlan — abono a capital manteniendo la cuota', () => {
  it('con interés acorta el plazo', () => {
    // 121 y no 120 a propósito: la cuota 932,63 viene redondeada al centavo,
    // así que tras 120 pagos quedan ~Bs 4,40 de capital y hace falta una
    // cuota más (chiquita, la última siempre absorbe el resto). La base hace
    // exactamente este mismo ceil — que las dos digan lo mismo importa más
    // que ahorrar un mes de cola.
    expect(mesesDelPlan(42300, 2, 932.63)).toBe(121);
    // Con Bs 10.000 menos de capital, la misma cuota lo termina en 60 meses:
    // la mitad del plazo por menos de un cuarto del capital, que es lo que
    // hace el interés compuesto cuando se adelanta plata.
    expect(mesesDelPlan(32300, 2, 932.63)).toBe(60);
  });

  it('sin interés es la división', () => {
    expect(mesesDelPlan(18000, 0, 2000)).toBe(9);
  });

  it('avisa cuando la cuota no cubre ni el interés', () => {
    expect(mesesDelPlan(100000, 2, 500)).toBe(0);
  });
});

// El lote exacto de la captura del mostrador: Bs 36.952,76 con la
// clasificación de 15% y 2% mensual a 12 meses. Las cifras salieron de correr
// la cuenta en la base; si la pantalla mostrara otra, esta prueba falla.
describe('el lote de la captura — Bs 36.952,76 al 2% en 12 meses', () => {
  const precio = 36952.76;
  const inicial = 5542.91; // 15% de la clasificación
  const financia = Math.round((precio - inicial) * 100) / 100;

  it('financia lo que queda tras la inicial', () => {
    expect(financia).toBe(31409.85);
  });

  it('la cuota es la que dice la base', () => {
    expect(cuotaDelPlan(financia, 2, 12)).toBe(2970.1);
  });

  it('el interés total del plazo', () => {
    const cuota = cuotaDelPlan(financia, 2, 12);
    expect(Math.round(cuota * 12 * 100) / 100).toBe(35641.2);
    expect(Math.round((cuota * 12 - financia) * 100) / 100).toBe(4231.35);
  });
});
