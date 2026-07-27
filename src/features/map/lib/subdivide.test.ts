import { describe, expect, it } from 'vitest';
import { parseFrontageSpec, subdivideManzana } from './subdivide';
import { ringArea } from './geom';
import type { Ring } from './types';

const rect = (x: number, y: number, w: number, h: number): Ring => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

describe('parseFrontageSpec', () => {
  it('parses corner + repeated + corner', () => {
    expect(parseFrontageSpec('12; 3x10; 12')).toEqual([12, 10, 10, 10, 12]);
  });
  it('parses llenar', () => {
    expect(parseFrontageSpec('llenar x10', 100)).toEqual(Array(10).fill(10));
  });
  it('llenar leaves remainder to the caller', () => {
    expect(parseFrontageSpec('llenar x10', 105)).toHaveLength(10);
  });
  it('rejects garbage', () => {
    expect(() => parseFrontageSpec('abc')).toThrow();
  });
});

describe('subdivideManzana — two rows on a rectangle (the plano M-24 pattern)', () => {
  // 180m × 50m block: two back-to-back rows of 25m depth, 18 lots of 10m each.
  const block = rect(0, 0, 180, 50);
  const result = subdivideManzana(block, {
    sideAHint: [90, -20], // street south of the block
    rows: 2,
    frontagesA: parseFrontageSpec('18x10'),
    frontagesB: parseFrontageSpec('18x10'),
  });

  it('produces 36 lots with no leftover', () => {
    expect(result.lots).toHaveLength(36);
    expect(result.leftoverA).toBeCloseTo(0, 1);
    expect(result.leftoverB).toBeCloseTo(0, 1);
    expect(result.warnings).toEqual([]);
  });

  it('each lot is 10 × 25 = 250 m²', () => {
    for (const lot of result.lots) {
      expect(lot.area_m2).toBeCloseTo(250, 0);
      expect(lot.frontage_m).toBe(10);
      expect(lot.depth_m).toBeCloseTo(25, 1);
    }
  });

  it('lots tile the block exactly', () => {
    const total = result.lots.reduce((s, l) => s + ringArea(l.ring), 0);
    expect(total).toBeCloseTo(180 * 50, 0);
  });

  it('row A (south, near the hint) comes first and is numbered 1..18', () => {
    const first = result.lots[0];
    expect(first.number).toBe('1');
    // South row lots have all y ≤ 25 (+ epsilon).
    for (const lot of result.lots.slice(0, 18)) {
      for (const [, y] of lot.ring) expect(y).toBeLessThanOrEqual(25.01);
    }
    for (const lot of result.lots.slice(18)) {
      for (const [, y] of lot.ring) expect(y).toBeGreaterThanOrEqual(24.99);
    }
  });

  it('marks the end lots of each row as corners', () => {
    const corners = result.lots.filter((l) => l.is_corner).map((l) => l.number);
    expect(corners).toEqual(['1', '18', '19', '36']);
  });
});

describe('subdivideManzana — mixed frontages with wider corner lots', () => {
  // "12; 15x10; 12" → 174m of frontage on a 174m block.
  const block = rect(0, 0, 174, 50);
  const spec = parseFrontageSpec('12; 15x10; 12');
  const result = subdivideManzana(block, {
    sideAHint: [87, -10],
    rows: 2,
    frontagesA: spec,
    frontagesB: spec,
  });

  it('corner lots are wider', () => {
    const rowA = result.lots.slice(0, 17);
    expect(rowA[0].area_m2).toBeCloseTo(12 * 25, 0);
    expect(rowA[1].area_m2).toBeCloseTo(10 * 25, 0);
    expect(rowA[16].area_m2).toBeCloseTo(12 * 25, 0);
  });
});

describe('subdivideManzana — rotated block', () => {
  // Same 180×50 block rotated 30°: the OMBR must recover the axes.
  const rot = (p: [number, number], ang: number): [number, number] => [
    p[0] * Math.cos(ang) - p[1] * Math.sin(ang),
    p[0] * Math.sin(ang) + p[1] * Math.cos(ang),
  ];
  const ang = Math.PI / 6;
  const block = rect(0, 0, 180, 50).map((p) => rot(p, ang)) as Ring;
  const hint = rot([90, -20], ang);

  const result = subdivideManzana(block, {
    sideAHint: hint,
    rows: 2,
    frontagesA: parseFrontageSpec('18x10'),
  });

  it('still produces 36 lots of ~250 m²', () => {
    expect(result.lots).toHaveLength(36);
    for (const lot of result.lots) {
      expect(lot.area_m2).toBeGreaterThan(245);
      expect(lot.area_m2).toBeLessThan(255);
    }
  });
});

describe('subdivideManzana — single row', () => {
  const block = rect(0, 0, 100, 30);
  const result = subdivideManzana(block, {
    sideAHint: [50, -10],
    rows: 1,
    frontagesA: parseFrontageSpec('10x10'),
  });

  it('produces 10 full-depth lots', () => {
    expect(result.lots).toHaveLength(10);
    for (const lot of result.lots) {
      expect(lot.area_m2).toBeCloseTo(300, 0);
    }
  });
});

describe('subdivideManzana — block whose long axis is VERTICAL', () => {
  // The site strip runs north; a block rotated 90° must subdivide along its own
  // long axis with the hint taken off a LONG (west/east) edge, not a short one.
  const block = rect(0, 0, 50, 180); // 50 m wide (2 lot rows) × 180 m tall
  const result = subdivideManzana(block, {
    sideAHint: [-20, 90], // west edge
    rows: 2,
    frontagesA: parseFrontageSpec('18x10'),
  });

  it('produces 36 lots of 250 m² with 10 m fronts and 25 m depth', () => {
    expect(result.lots).toHaveLength(36);
    expect(result.warnings).toEqual([]);
    for (const lot of result.lots) {
      expect(lot.area_m2).toBeCloseTo(250, 0);
      expect(lot.frontage_m).toBe(10);
      expect(lot.depth_m).toBeCloseTo(25, 1);
    }
  });

  it('row A is the west row (nearest the hint)', () => {
    for (const lot of result.lots.slice(0, 18)) {
      for (const [x] of lot.ring) expect(x).toBeLessThanOrEqual(25.01);
    }
    for (const lot of result.lots.slice(18)) {
      for (const [x] of lot.ring) expect(x).toBeGreaterThanOrEqual(24.99);
    }
  });

  it('tiles the block exactly', () => {
    const total = result.lots.reduce((s, l) => s + ringArea(l.ring), 0);
    expect(total).toBeCloseTo(50 * 180, 0);
  });
});

describe('subdivideManzana — spec longer than the block warns', () => {
  const block = rect(0, 0, 100, 50);
  const result = subdivideManzana(block, {
    sideAHint: [50, -10],
    rows: 2,
    frontagesA: parseFrontageSpec('12x10'), // 120m on a 100m front
  });

  it('emits a warning and drops the overflowing lots', () => {
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.lots.length).toBeLessThan(24);
  });
});

describe('subdivideManzana — block with filleted corners (R9 tessellated)', () => {
  // South-east corner replaced by an 8-segment R9 fillet; corner lot absorbs it.
  const R = 9;
  const fillet: Ring = [];
  for (let i = 0; i <= 8; i++) {
    const a = (Math.PI / 2) * (i / 8);
    fillet.push([180 - R + R * Math.sin(a), R - R * Math.cos(a)]);
  }
  const block: Ring = [[0, 0], ...fillet, [180, 50], [0, 50]];

  const result = subdivideManzana(block, {
    sideAHint: [90, -10],
    rows: 2,
    frontagesA: parseFrontageSpec('18x10'),
  });

  it('the SE corner lot loses the fillet area, others stay 250 m²', () => {
    const corner = result.lots[17]; // last of row A (east end)
    const filletLoss = R * R - (Math.PI * R * R) / 4; // ≈ 17.4 m²
    expect(corner.area_m2).toBeLessThan(250 - filletLoss * 0.5);
    expect(corner.area_m2).toBeGreaterThan(250 - filletLoss * 1.5);
    expect(result.lots[5].area_m2).toBeCloseTo(250, 0);
  });
});
