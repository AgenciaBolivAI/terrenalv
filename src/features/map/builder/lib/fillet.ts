// Corner fillet: replace one ring vertex with a tessellated circular arc
// tangent to both adjacent edges (the plano's R9.00 rounded corners).

import { add, dist, normalize, round2, scale, sub } from '../../lib/geom';
import type { Pt, Ring } from '../../lib/types';

export interface FilletResult {
  ring: Ring;
}

/**
 * Returns the ring with vertex `index` replaced by an arc of `radius` meters,
 * tessellated into `segments` straight segments, or an error string (Spanish).
 */
export function filletVertex(
  ring: Ring,
  index: number,
  radius: number,
  segments = 8,
): FilletResult | { error: string } {
  const n = ring.length;
  if (n < 3) return { error: 'El contorno necesita al menos 3 vértices.' };
  if (!(radius > 0)) return { error: 'Radio inválido.' };
  const V = ring[index];
  const A = ring[(index - 1 + n) % n];
  const B = ring[(index + 1) % n];

  const d1 = normalize(sub(A, V));
  const d2 = normalize(sub(B, V));
  const cosT = Math.max(-1, Math.min(1, d1[0] * d2[0] + d1[1] * d2[1]));
  const theta = Math.acos(cosT);
  if (theta < 0.03 || theta > Math.PI - 0.03) {
    return { error: 'La esquina es demasiado plana o cerrada para redondear.' };
  }

  const t = radius / Math.tan(theta / 2);
  if (t > dist(V, A) - 0.01 || t > dist(V, B) - 0.01) {
    return { error: `El radio ${radius} m no cabe en los lados de esta esquina.` };
  }

  const p1 = add(V, scale(d1, t)); // tangent point on edge V→A
  const p2 = add(V, scale(d2, t)); // tangent point on edge V→B
  const bisector = normalize(add(d1, d2));
  const center = add(V, scale(bisector, radius / Math.sin(theta / 2)));

  const a1 = Math.atan2(p1[1] - center[1], p1[0] - center[0]);
  const a2 = Math.atan2(p2[1] - center[1], p2[0] - center[0]);
  // Short sweep (the arc spans π − θ < π).
  let sweep = a2 - a1;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;

  const arc: Pt[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = a1 + (sweep * i) / segments;
    arc.push([
      round2(center[0] + radius * Math.cos(a)),
      round2(center[1] + radius * Math.sin(a)),
    ]);
  }

  const out: Ring = [];
  for (let i = 0; i < n; i++) {
    if (i === index) out.push(...arc);
    else out.push(ring[i]);
  }
  return { ring: out };
}
