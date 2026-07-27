// Two-row band subdivision: manzana polygon + frontage spec → lot polygons.
// One code path for BOTH the seed generator and the admin Map Builder, so the
// team's later corrections are edits, not rebuilds.
//
// Model: the block's oriented bounding box gives a local (u, v) frame; lots are
// cells of a rotated grid — frontage slabs along u, row bands along v — clipped
// to the real outline. Irregular ends and tessellated R9 fillets are absorbed by
// the clipping, so corner lots need no special-case geometry.

import polygonClipping from 'polygon-clipping';
import type { Pt, Ring, GeneratedLot, SubdivideOptions, SubdivideResult } from './types';
import {
  add,
  centroid,
  chainLength,
  dist,
  dot,
  ensureCCW,
  normalize,
  orientedBoundingBox,
  pointAtLength,
  ringArea,
  round2,
  roundPt,
  scale,
  sub,
} from './geom';

/**
 * Frontage spec mini-DSL (same syntax in the Builder UI):
 *   "12; 3x10; 12"  → [12, 10, 10, 10, 12]
 *   "llenar x10"    → fill the available length with 10m lots (needs chainLen)
 * Separators: ';' or ','.
 */
export function parseFrontageSpec(spec: string, chainLen?: number): number[] {
  const out: number[] = [];
  const parts = spec
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const part of parts) {
    const fill = part.match(/^llenar\s*x\s*([\d.]+)$/i);
    if (fill) {
      if (chainLen == null) throw new Error('llenar necesita la longitud del frente');
      const w = parseFloat(fill[1]);
      const used = out.reduce((s, f) => s + f, 0);
      const count = Math.floor((chainLen - used) / w + 1e-6);
      for (let i = 0; i < count; i++) out.push(w);
      continue;
    }
    const mult = part.match(/^(\d+)\s*x\s*([\d.]+)$/i);
    if (mult) {
      const count = parseInt(mult[1], 10);
      const w = parseFloat(mult[2]);
      for (let i = 0; i < count; i++) out.push(w);
      continue;
    }
    const single = parseFloat(part);
    if (!Number.isFinite(single) || single <= 0) {
      throw new Error(`especificación de frentes inválida: "${part}"`);
    }
    out.push(single);
  }
  return out;
}

interface Chain {
  points: Pt[];
  length: number;
}

/** Split the ring's edges into "long" chains (front candidates) using the long axis. */
function extractLongChains(ring: Ring, u: Pt): Chain[] {
  const n = ring.length;
  const isLong: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const d = normalize(sub(ring[(i + 1) % n], ring[i]));
    isLong.push(Math.abs(dot(d, u)) > Math.SQRT1_2); // within 45° of the long axis
  }
  const chains: Chain[] = [];
  let start = 0;
  while (start < n && !(isLong[start] && !isLong[(start + n - 1) % n])) start++;
  if (start === n) {
    const half = Math.floor(n / 2);
    const a = ring.slice(0, half + 1);
    const b = [...ring.slice(half), ring[0]];
    return [
      { points: a, length: chainLength(a) },
      { points: b, length: chainLength(b) },
    ];
  }
  let i = start;
  let visited = 0;
  while (visited < n) {
    if (isLong[i]) {
      const pts: Pt[] = [ring[i]];
      while (isLong[i] && visited < n) {
        pts.push(ring[(i + 1) % n]);
        i = (i + 1) % n;
        visited++;
      }
      chains.push({ points: pts, length: chainLength(pts) });
    } else {
      i = (i + 1) % n;
      visited++;
    }
  }
  chains.sort((a, b) => b.length - a.length);
  return chains;
}

const toClipPoly = (ring: Ring): polygonClipping.Polygon => [
  [...ring.map((p) => [p[0], p[1]] as [number, number]), [ring[0][0], ring[0][1]]],
];

function fromClipResult(mp: polygonClipping.MultiPolygon): Ring | null {
  if (!mp.length) return null;
  let best: Ring | null = null;
  let bestArea = 0;
  for (const poly of mp) {
    const outer = poly[0];
    const ring: Ring = outer.slice(0, outer.length - 1).map((p) => [p[0], p[1]]);
    const a = ringArea(ring);
    if (a > bestArea) {
      bestArea = a;
      best = ring;
    }
  }
  return best;
}

/** Axis-aligned rectangle in (u, v) space expressed as a world-space ring. */
function frameRect(u: Pt, v: Pt, u0: number, u1: number, v0: number, v1: number): Ring {
  const corner = (su: number, sv: number): Pt => add(scale(u, su), scale(v, sv));
  return ensureCCW([corner(u0, v0), corner(u1, v0), corner(u1, v1), corner(u0, v1)]);
}

function subdivideRow(params: {
  manzana: Ring;
  u: Pt;
  v: Pt;
  vFront: number;
  interiorSign: number;
  depth: number;
  startS: number;
  dirSign: number;
  frontages: number[];
  uSpan: [number, number];
  vSpan: [number, number];
  rowLabel: string;
}): { rings: Ring[]; warnings: string[] } {
  const { manzana, u, v, vFront, interiorSign, depth, startS, dirSign, frontages, uSpan, vSpan, rowLabel } = params;
  const warnings: string[] = [];

  // Row band: from just outside the front line to `depth` toward the interior.
  const vLo = Math.min(vFront - interiorSign * 1, vFront + interiorSign * depth);
  const vHi = Math.max(vFront - interiorSign * 1, vFront + interiorSign * depth);
  const band = polygonClipping.intersection(
    toClipPoly(manzana),
    toClipPoly(frameRect(u, v, uSpan[0] - 5, uSpan[1] + 5, vLo, vHi)),
  );
  if (!band.length) return { rings: [], warnings: [`${rowLabel}: banda vacía`] };

  const rings: Ring[] = [];
  let acc = 0;
  for (let i = 0; i < frontages.length; i++) {
    const s0 = startS + dirSign * acc;
    acc += frontages[i];
    const s1 = startS + dirSign * acc;
    const slab = frameRect(u, v, Math.min(s0, s1), Math.max(s0, s1), vSpan[0] - 5, vSpan[1] + 5);
    const clipped = polygonClipping.intersection(band, toClipPoly(slab));
    const ring = fromClipResult(clipped);
    if (!ring || ringArea(ring) < 1) {
      warnings.push(`${rowLabel}: lote ${i + 1} quedó fuera del bloque`);
      continue;
    }
    rings.push(ensureCCW(ring.map(roundPt)));
  }
  return { rings, warnings };
}

/** Subdivide a manzana into one or two back-to-back rows of lots. */
export function subdivideManzana(ringIn: Ring, opts: SubdivideOptions): SubdivideResult {
  const ring = ensureCCW(ringIn.map(roundPt));
  const { u, v, lengthV } = orientedBoundingBox(ring);
  const chains = extractLongChains(ring, u);
  if (!chains.length) throw new Error('no se encontró un frente');

  const interior = centroid(ring);
  const uCoords = ring.map((p) => dot(p, u));
  const vCoords = ring.map((p) => dot(p, v));
  const uSpan: [number, number] = [Math.min(...uCoords), Math.max(...uCoords)];
  const vSpan: [number, number] = [Math.min(...vCoords), Math.max(...vCoords)];

  const byHint = [...chains.slice(0, 2)].sort(
    (a, b) => chainMidDist(a.points, opts.sideAHint) - chainMidDist(b.points, opts.sideAHint),
  );
  const chainA = byHint[0];
  const chainB = byHint[1] ?? null;

  const warnings: string[] = [];
  const lots: GeneratedLot[] = [];
  const startNum = opts.numbering?.start ?? 1;

  const rowFor = (
    chain: Chain,
    frontages: number[],
    depth: number | null,
    direction: 'forward' | 'reverse',
    label: string,
  ) => {
    const pts = direction === 'reverse' ? [...chain.points].reverse() : chain.points;
    const first = pts[0];
    const last = pts[pts.length - 1];
    const dirSign = Math.sign(dot(sub(last, first), u)) || 1;
    const startS = dot(first, u);
    const straightLen = Math.abs(dot(sub(last, first), u));
    const vFront = dot(pointAtLength(pts, chainLength(pts) / 2).point, v);
    const interiorSign = Math.sign(dot(interior, v) - vFront) || 1;
    const total = frontages.reduce((s, f) => s + f, 0);
    if (total - straightLen > 0.3) {
      warnings.push(
        `${label}: los frentes suman ${round2(total)} m pero el frente mide ${round2(straightLen)} m`,
      );
    }
    const r = subdivideRow({
      manzana: ring,
      u,
      v,
      vFront,
      interiorSign,
      depth: depth ?? lengthV,
      startS,
      dirSign,
      frontages,
      uSpan,
      vSpan,
      rowLabel: label,
    });
    warnings.push(...r.warnings);
    return { rings: r.rings, leftover: round2(straightLen - total), depth: depth ?? lengthV };
  };

  if (opts.rows === 1) {
    const rA = rowFor(chainA, opts.frontagesA, null, opts.numbering?.directionA ?? 'forward', 'fila A');
    rA.rings.forEach((lotRing, i) => {
      lots.push(makeLot(lotRing, startNum + i, opts.frontagesA[i], rA.depth, i, rA.rings.length));
    });
    return { lots, leftoverA: rA.leftover, leftoverB: 0, warnings };
  }

  if (!chainB) throw new Error('rows: 2 requiere dos frentes largos');
  const depthA = opts.depthA ?? round2(lengthV / 2);
  const depthB = round2(lengthV - depthA);
  const frontagesB = opts.frontagesB ?? opts.frontagesA;

  const rA = rowFor(chainA, opts.frontagesA, depthA, opts.numbering?.directionA ?? 'forward', 'fila A');
  const rB = rowFor(chainB, frontagesB, depthB, opts.numbering?.directionB ?? 'forward', 'fila B');

  rA.rings.forEach((lotRing, i) => {
    lots.push(makeLot(lotRing, startNum + i, opts.frontagesA[i], depthA, i, rA.rings.length));
  });
  rB.rings.forEach((lotRing, i) => {
    lots.push(
      makeLot(lotRing, startNum + rA.rings.length + i, frontagesB[i], depthB, i, rB.rings.length),
    );
  });

  return { lots, leftoverA: rA.leftover, leftoverB: rB.leftover, warnings };
}

function chainMidDist(chain: Pt[], hint: Pt): number {
  const mid = pointAtLength(chain, chainLength(chain) / 2).point;
  return dist(mid, hint);
}

function makeLot(
  ring: Ring,
  number: number,
  frontage: number,
  depth: number,
  indexInRow: number,
  rowCount: number,
): GeneratedLot {
  return {
    number: String(number),
    ring,
    frontage_m: round2(frontage),
    depth_m: round2(depth),
    area_m2: round2(ringArea(ring)),
    is_corner: indexInRow === 0 || indexInRow === rowCount - 1,
  };
}
