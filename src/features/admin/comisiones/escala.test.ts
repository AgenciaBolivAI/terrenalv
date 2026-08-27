// La escala del Directorio, verificada contra los ejemplos del documento.
//
// El documento trae una tabla de ejemplos con un lote de Bs 12.800 y los
// acumulados de cada tramo. Si alguna vez alguien cambia la regla sin querer,
// estos números lo delatan.

import { describe, expect, it } from 'vitest';

interface Tramo {
  desde: number;
  hasta: number | null;
  pct: number;
}

// La escala 2026 tal cual se sembró en la base.
const PLAZO: Tramo[] = [
  { desde: 1, hasta: 6, pct: 1.0 },
  { desde: 7, hasta: 10, pct: 1.2 },
  { desde: 11, hasta: 15, pct: 1.4 },
  { desde: 16, hasta: 20, pct: 1.6 },
  { desde: 21, hasta: null, pct: 1.8 },
];

const CONTADO: Tramo[] = [
  { desde: 1, hasta: 5, pct: 1.0 },
  { desde: 6, hasta: 10, pct: 1.5 },
  { desde: 11, hasta: 15, pct: 1.8 },
  { desde: 16, hasta: null, pct: 2.0 },
];

/** El tramo donde cae una cantidad de ventas. Misma regla que la vista. */
export function tramoDe(escala: Tramo[], n: number): Tramo | undefined {
  return escala.find((t) => n >= t.desde && (t.hasta === null || n <= t.hasta));
}

/** Comisión por lote, al porcentaje del tramo alcanzado. */
export function comisionPorLote(escala: Tramo[], n: number, lote: number): number {
  const t = tramoDe(escala, n);
  if (!t) return 0;
  return Math.round(((lote * t.pct) / 100) * 100) / 100;
}

const LOTE = 12800;

describe('escala a plazo — ejemplos del documento', () => {
  it.each([
    [1, 128, 128],
    [6, 128, 768],
    [7, 153.6, 1075.2],
    [10, 153.6, 1536],
    [11, 179.2, 1971.2],
    [15, 179.2, 2688],
    [16, 204.8, 3276.8],
    [20, 204.8, 4096],
    [21, 230.4, 4838.4],
  ])('con %i ventas: %d por lote, %d acumulado', (n, porLote, acumulado) => {
    const c = comisionPorLote(PLAZO, n as number, LOTE);
    expect(c).toBeCloseTo(porLote as number, 2);
    expect(Math.round(c * (n as number) * 100) / 100).toBeCloseTo(acumulado as number, 2);
  });
});

describe('escala al contado — ejemplos del documento', () => {
  it.each([
    [1, 128, 128],
    [5, 128, 640],
    [6, 192, 1152],
    [10, 192, 1920],
    [11, 230.4, 2534.4],
    [15, 230.4, 3456],
    [16, 256, 4096],
  ])('con %i ventas: %d por lote, %d acumulado', (n, porLote, acumulado) => {
    const c = comisionPorLote(CONTADO, n as number, LOTE);
    expect(c).toBeCloseTo(porLote as number, 2);
    expect(Math.round(c * (n as number) * 100) / 100).toBeCloseTo(acumulado as number, 2);
  });
});

describe('la escala es retroactiva', () => {
  it('vender la séptima a plazo sube el % de las siete, no sólo de la última', () => {
    // Seis ventas: 6 × 128 = 768. La séptima no suma 128 sino que reencuadra
    // todo a 1,2%: 7 × 153,60 = 1.075,20. Es decir, vender una más agregó
    // Bs 307,20 de comisión, no Bs 153,60.
    const seis = comisionPorLote(PLAZO, 6, LOTE) * 6;
    const siete = comisionPorLote(PLAZO, 7, LOTE) * 7;
    expect(seis).toBeCloseTo(768, 2);
    expect(siete).toBeCloseTo(1075.2, 2);
    expect(siete - seis).toBeCloseTo(307.2, 2);
  });

  it('al contado, la sexta venta salta de 1% a 1,5% sobre todo', () => {
    const cinco = comisionPorLote(CONTADO, 5, LOTE) * 5;
    const seis = comisionPorLote(CONTADO, 6, LOTE) * 6;
    expect(cinco).toBeCloseTo(640, 2);
    expect(seis).toBeCloseTo(1152, 2);
  });
});

describe('las dos escalas son distintas a propósito', () => {
  it('desde la sexta venta, contado paga más que plazo', () => {
    for (const n of [6, 7, 10, 11, 15, 16, 21]) {
      expect(comisionPorLote(CONTADO, n, LOTE)).toBeGreaterThan(comisionPorLote(PLAZO, n, LOTE));
    }
  });

  it('hasta la quinta, ambas pagan 1%', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      expect(comisionPorLote(CONTADO, n, LOTE)).toBeCloseTo(comisionPorLote(PLAZO, n, LOTE), 2);
    }
  });
});
