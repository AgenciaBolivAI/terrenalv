// Pure planar geometry utilities shared by the seed generator, the Map Builder,
// and the renderers. No dependencies.

import type { Pt, Ring } from './types';

export const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
export const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
export const scale = (a: Pt, s: number): Pt => [a[0] * s, a[1] * s];
export const dot = (a: Pt, b: Pt): number => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Pt, b: Pt): number => a[0] * b[1] - a[1] * b[0];
export const len = (a: Pt): number => Math.hypot(a[0], a[1]);
export const dist = (a: Pt, b: Pt): number => len(sub(a, b));
export const normalize = (a: Pt): Pt => {
  const l = len(a);
  return l === 0 ? [0, 0] : [a[0] / l, a[1] / l];
};
/** Left-hand perpendicular (rotate +90°). */
export const perp = (a: Pt): Pt => [-a[1], a[0]];

export const round2 = (n: number): number => Math.round(n * 100) / 100;
export const roundPt = (p: Pt): Pt => [round2(p[0]), round2(p[1])];

/** Signed area (positive = counterclockwise). Ring is open. */
export function signedArea(ring: Ring): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export const ringArea = (ring: Ring): number => Math.abs(signedArea(ring));

/** Returns the ring in counterclockwise orientation. */
export function ensureCCW(ring: Ring): Ring {
  return signedArea(ring) >= 0 ? ring : [...ring].reverse();
}

export function centroid(ring: Ring): Pt {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const w = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * w;
    cy += (p[1] + q[1]) * w;
    a += w;
  }
  if (Math.abs(a) < 1e-9) {
    // Degenerate: average the points.
    const n = ring.length;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function bbox(ring: Ring): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of ring) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

/** Andrew's monotone chain convex hull. Returns CCW hull, open ring. */
export function convexHull(points: Pt[]): Ring {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length <= 2) return pts;
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(sub(lower[lower.length - 1], lower[lower.length - 2]), sub(p, lower[lower.length - 2])) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(sub(upper[upper.length - 1], upper[upper.length - 2]), sub(p, upper[upper.length - 2])) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Oriented minimum-area bounding rectangle via rotating calipers over hull edges.
 * Returns the unit long axis `u`, its normal `v`, and the extents along each.
 */
export function orientedBoundingBox(ring: Ring): {
  u: Pt;
  v: Pt;
  lengthU: number;
  lengthV: number;
} {
  const hull = convexHull(ring);
  let best: { u: Pt; v: Pt; lengthU: number; lengthV: number; area: number } | null = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const u = normalize(sub(b, a));
    if (len(u) === 0) continue;
    const v = perp(u);
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of hull) {
      const pu = dot(p, u);
      const pv = dot(p, v);
      if (pu < minU) minU = pu;
      if (pu > maxU) maxU = pu;
      if (pv < minV) minV = pv;
      if (pv > maxV) maxV = pv;
    }
    const du = maxU - minU;
    const dv = maxV - minV;
    const area = du * dv;
    if (!best || area < best.area) {
      // Long axis is u by convention: swap if needed.
      best = du >= dv
        ? { u, v, lengthU: du, lengthV: dv, area }
        : { u: v, v: scale(u, -1), lengthU: dv, lengthV: du, area };
    }
  }
  if (!best) throw new Error('degenerate ring');
  return { u: best.u, v: best.v, lengthU: best.lengthU, lengthV: best.lengthV };
}

/** Total length of an open polyline. */
export function chainLength(chain: Pt[]): number {
  let s = 0;
  for (let i = 0; i < chain.length - 1; i++) s += dist(chain[i], chain[i + 1]);
  return s;
}

/** Point at arc-length t along an open polyline, with the segment direction there. */
export function pointAtLength(chain: Pt[], t: number): { point: Pt; dir: Pt } {
  let acc = 0;
  for (let i = 0; i < chain.length - 1; i++) {
    const segLen = dist(chain[i], chain[i + 1]);
    if (acc + segLen >= t - 1e-9) {
      const k = segLen === 0 ? 0 : (t - acc) / segLen;
      const dir = normalize(sub(chain[i + 1], chain[i]));
      return { point: add(chain[i], scale(sub(chain[i + 1], chain[i]), k)), dir };
    }
    acc += segLen;
  }
  const last = chain.length - 1;
  return { point: chain[last], dir: normalize(sub(chain[last], chain[last - 1])) };
}

/** Offset an open polyline sideways (positive = toward `normalDir`), joining miters. */
export function offsetChain(chain: Pt[], distance: number, normalDir: Pt): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < chain.length; i++) {
    let n: Pt;
    if (i === 0) {
      n = perp(normalize(sub(chain[1], chain[0])));
    } else if (i === chain.length - 1) {
      n = perp(normalize(sub(chain[i], chain[i - 1])));
    } else {
      const n1 = perp(normalize(sub(chain[i], chain[i - 1])));
      const n2 = perp(normalize(sub(chain[i + 1], chain[i])));
      n = normalize(add(n1, n2));
      // Miter scale so the offset distance is preserved at the joint.
      const cos = dot(n, n1);
      if (Math.abs(cos) > 1e-6) n = scale(n, 1 / cos);
    }
    // Flip so the offset goes toward normalDir.
    if (dot(perp(normalize(i < chain.length - 1 ? sub(chain[i + 1], chain[i]) : sub(chain[i], chain[i - 1]))), normalDir) < 0) {
      n = scale(n, -1);
    }
    out.push(add(chain[i], scale(n, distance)));
  }
  return out;
}
