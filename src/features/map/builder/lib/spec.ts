// subdivision_spec (jsonb) ⇄ SubdividePanel form state. Superset of the seed
// generator's shape ({rows, depthA, frontA, frontB, hint}) so pre-seeded specs
// prefill correctly and saved specs stay compatible.

import { bbox } from '../../lib/geom';
import type { Pt, Ring } from '../../lib/types';

export type NumberDirection = 'forward' | 'reverse';

export interface SpecDraft {
  rows: 1 | 2;
  depthA: string; // '' = midline split
  frontA: string;
  frontB: string; // '' = same as A
  start: string; // numbering start, '' = 1
  dirA: NumberDirection;
  dirB: NumberDirection;
}

export const DEFAULT_SPEC: SpecDraft = {
  rows: 2,
  depthA: '',
  frontA: '',
  frontB: '',
  start: '',
  dirA: 'forward',
  dirB: 'forward',
};

type Cardinal = 'S' | 'N' | 'W' | 'E';

export function specFromJson(json: Record<string, unknown> | null | undefined): SpecDraft {
  if (!json) return { ...DEFAULT_SPEC };
  const rows = json.rows === 1 ? 1 : 2;
  const num = (v: unknown): string =>
    typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const dir = (v: unknown): NumberDirection => (v === 'reverse' ? 'reverse' : 'forward');
  const frontA = str(json.frontA);
  const frontB = str(json.frontB);
  return {
    rows,
    depthA: num(json.depthA),
    frontA,
    frontB: frontB === frontA ? '' : frontB,
    start: num(json.start),
    dirA: dir(json.dirA),
    dirB: dir(json.dirB),
  };
}

export function specToJson(d: SpecDraft, hintPoint: Pt | null, ring: Ring | null): Record<string, unknown> {
  return {
    rows: d.rows,
    depthA: d.depthA.trim() === '' ? null : Number(d.depthA),
    frontA: d.frontA.trim(),
    frontB: d.frontB.trim() === '' ? d.frontA.trim() : d.frontB.trim(),
    hint: hintPoint && ring ? cardinalOf(hintPoint, ring) : 'S',
    ...(hintPoint ? { hintPoint: [hintPoint[0], hintPoint[1]] } : {}),
    ...(d.start.trim() !== '' ? { start: Number(d.start) } : {}),
    dirA: d.dirA,
    dirB: d.dirB,
  };
}

/** Point 15 m outside the ring bbox on the given side (seed convention). */
export function cardinalPoint(card: Cardinal, ring: Ring): Pt {
  const [x0, y0, x1, y1] = bbox(ring);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  switch (card) {
    case 'S':
      return [cx, y0 - 15];
    case 'N':
      return [cx, y1 + 15];
    case 'W':
      return [x0 - 15, cy];
    case 'E':
      return [x1 + 15, cy];
  }
}

export function cardinalOf(p: Pt, ring: Ring): Cardinal {
  const [x0, y0, x1, y1] = bbox(ring);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const dx = p[0] - cx;
  const dy = p[1] - cy;
  if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? 'E' : 'W';
  return dy >= 0 ? 'N' : 'S';
}

/** Resolve the stored spec's front-side hint to a plan point. */
export function hintFromSpec(
  json: Record<string, unknown> | null | undefined,
  ring: Ring | null,
): Pt | null {
  if (!json || !ring || ring.length < 3) return null;
  const hp = json.hintPoint;
  if (Array.isArray(hp) && Number.isFinite(hp[0]) && Number.isFinite(hp[1])) {
    return [Number(hp[0]), Number(hp[1])];
  }
  const card = json.hint;
  if (card === 'S' || card === 'N' || card === 'W' || card === 'E') {
    return cardinalPoint(card, ring);
  }
  return null;
}
