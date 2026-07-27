// Snapping rules for the Builder tools (all distances in plan meters).
//  * Draw tool: 0.25 m grid + 45°/90° relative to the previous segment + snap
//    to existing manzana vertices within 0.5 m. Shift disables everything.
//  * Vertex tool: 0.05 m grid.

import { add, dist, round2, scale } from '../../lib/geom';
import type { Pt } from '../../lib/types';

export const GRID_DRAW = 0.25;
export const GRID_VERTEX = 0.05;
export const VERTEX_SNAP_DIST = 0.5;
/** Vertices closer than this (1 cm) are treated as the same shared corner. */
export const SHARED_EPS = 0.01;

export function snapToGrid(p: Pt, grid: number): Pt {
  return [round2(Math.round(p[0] / grid) * grid), round2(Math.round(p[1] / grid) * grid)];
}

export function nearestVertex(p: Pt, pool: Pt[], maxDist: number): Pt | null {
  let best: Pt | null = null;
  let bestD = maxDist;
  for (const v of pool) {
    const d = dist(p, v);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}

export interface DrawSnap {
  point: Pt;
  kind: 'vertex' | 'angle' | 'grid' | 'free';
}

/**
 * Snap a draw-tool cursor position. `prev` is the last placed point, `prevPrev`
 * the one before it (defines the reference direction; absolute east when absent).
 */
export function snapDrawPoint(
  raw: Pt,
  prev: Pt | null,
  prevPrev: Pt | null,
  vertexPool: Pt[],
  disabled: boolean,
): DrawSnap {
  if (disabled) {
    return { point: [round2(raw[0]), round2(raw[1])], kind: 'free' };
  }
  const v = nearestVertex(raw, vertexPool, VERTEX_SNAP_DIST);
  if (v) return { point: [v[0], v[1]], kind: 'vertex' };

  if (prev) {
    const dx = raw[0] - prev[0];
    const dy = raw[1] - prev[1];
    const len = Math.hypot(dx, dy);
    if (len >= GRID_DRAW / 2) {
      const base = prevPrev ? Math.atan2(prev[1] - prevPrev[1], prev[0] - prevPrev[0]) : 0;
      const rel = Math.atan2(dy, dx) - base;
      const snapRel = Math.round(rel / (Math.PI / 4)) * (Math.PI / 4);
      const ang = base + snapRel;
      const snapLen = Math.max(GRID_DRAW, Math.round(len / GRID_DRAW) * GRID_DRAW);
      const p = add(prev, scale([Math.cos(ang), Math.sin(ang)], snapLen));
      return { point: [round2(p[0]), round2(p[1])], kind: 'angle' };
    }
  }
  return { point: snapToGrid(raw, GRID_DRAW), kind: 'grid' };
}
