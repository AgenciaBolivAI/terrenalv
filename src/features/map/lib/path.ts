// Plan-space ring → SVG path string. The ONLY place the y-axis flip happens:
// plan-space is y-up (north), SVG is y-down. Callers pass the plan bbox's maxY
// so flipped coordinates stay positive.

import type { Pt, Ring } from './types';

export function ringToPath(ring: Ring, maxY: number): string {
  if (!ring.length) return '';
  let d = `M${ring[0][0]} ${round(maxY - ring[0][1])}`;
  for (let i = 1; i < ring.length; i++) {
    d += `L${ring[i][0]} ${round(maxY - ring[i][1])}`;
  }
  return d + 'Z';
}

export function lineToPath(line: Pt[], maxY: number): string {
  if (!line.length) return '';
  let d = `M${line[0][0]} ${round(maxY - line[0][1])}`;
  for (let i = 1; i < line.length; i++) {
    d += `L${line[i][0]} ${round(maxY - line[i][1])}`;
  }
  return d;
}

export function flipPt(p: Pt, maxY: number): Pt {
  return [p[0], round(maxY - p[1])];
}

const round = (n: number) => Math.round(n * 100) / 100;
