// 2D affine transforms as {a, b, c, d, e, f}:
//   x' = a*x + b*y + c
//   y' = d*x + e*y + f
// Used for plano-pixel → plan-space calibration and plan-space → UTM.

import type { Pt } from './types';

export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 };

export function apply(t: Affine, p: Pt): Pt {
  return [t.a * p[0] + t.b * p[1] + t.c, t.d * p[0] + t.e * p[1] + t.f];
}

export function compose(t2: Affine, t1: Affine): Affine {
  // apply(compose(t2,t1), p) === apply(t2, apply(t1, p))
  return {
    a: t2.a * t1.a + t2.b * t1.d,
    b: t2.a * t1.b + t2.b * t1.e,
    c: t2.a * t1.c + t2.b * t1.f + t2.c,
    d: t2.d * t1.a + t2.e * t1.d,
    e: t2.d * t1.b + t2.e * t1.e,
    f: t2.d * t1.c + t2.e * t1.f + t2.f,
  };
}

export function invert(t: Affine): Affine {
  const det = t.a * t.e - t.b * t.d;
  if (Math.abs(det) < 1e-12) throw new Error('transformación no invertible');
  const ia = t.e / det;
  const ib = -t.b / det;
  const id = -t.d / det;
  const ie = t.a / det;
  return {
    a: ia,
    b: ib,
    c: -(ia * t.c + ib * t.f),
    d: id,
    e: ie,
    f: -(id * t.c + ie * t.f),
  };
}

/**
 * Similarity transform (rotation + uniform scale + translation) from two point
 * correspondences — the two-click plano calibration.
 */
export function similarityFromTwoPoints(src1: Pt, src2: Pt, dst1: Pt, dst2: Pt): Affine {
  const [sx, sy] = [src2[0] - src1[0], src2[1] - src1[1]];
  const [dx, dy] = [dst2[0] - dst1[0], dst2[1] - dst1[1]];
  const srcLen2 = sx * sx + sy * sy;
  if (srcLen2 < 1e-12) throw new Error('los puntos de origen coinciden');
  // Solve dst = s*R*src + t where s*R = [[p, -q], [q, p]]
  const p = (sx * dx + sy * dy) / srcLen2;
  const q = (sx * dy - sy * dx) / srcLen2;
  return {
    a: p,
    b: -q,
    c: dst1[0] - (p * src1[0] - q * src1[1]),
    d: q,
    e: p,
    f: dst1[1] - (q * src1[0] + p * src1[1]),
  };
}

/** plan-space → UTM given the project's stored offset (pure translation). */
export function planToUtm(offsetE: number, offsetN: number): Affine {
  return { a: 1, b: 0, c: offsetE, d: 0, e: 1, f: offsetN };
}
