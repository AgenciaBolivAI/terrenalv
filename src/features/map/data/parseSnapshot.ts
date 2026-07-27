// GeometrySnapshot (storage JSON / seed-adapted) → render-ready structures.
// Every SVG path `d` string is computed EXACTLY ONCE here; components never
// rebuild geometry. All flipping goes through lib/path.ts (the only y-flip).

import { bbox as ringBbox, centroid, chainLength, pointAtLength } from '../lib/geom';
import { flipPt, lineToPath, ringToPath } from '../lib/path';
import type { Pt, Ring } from '../lib/types';
import type {
  GeometrySnapshot,
  MapElement,
  MapLot,
  MapManzana,
  SnapshotElement,
} from './types';

export interface ParsedGeometry {
  version: number;
  planBbox: [number, number, number, number];
  maxY: number;
  lots: Map<string, MapLot>;
  manzanas: MapManzana[];
  elements: MapElement[];
}

/**
 * publish_geometry emits GeoJSON rings (closed: first point repeated at the
 * end); the seed generator emits open rings. Normalize to the open `Ring`
 * contract before any geometry math.
 */
function toOpenRing(raw: number[][] | undefined | null): Ring {
  if (!Array.isArray(raw)) return [];
  const pts: Pt[] = [];
  for (const p of raw) {
    if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
      pts.push([p[0], p[1]]);
    }
  }
  if (pts.length >= 2) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (Math.abs(first[0] - last[0]) < 1e-6 && Math.abs(first[1] - last[1]) < 1e-6) {
      pts.pop();
    }
  }
  return pts;
}

/** Axis-aligned bbox of a ring AFTER the y-flip (SVG space). */
function svgBbox(ring: Ring, maxY: number): [number, number, number, number] {
  return ringBbox(ring.map((p) => flipPt(p, maxY)));
}

function isFiniteBbox(b: unknown): b is [number, number, number, number] {
  return (
    Array.isArray(b) &&
    b.length === 4 &&
    b.every((n) => Number.isFinite(n)) &&
    (b[2] as number) > (b[0] as number) &&
    (b[3] as number) > (b[1] as number)
  );
}

function parseElement(el: SnapshotElement, maxY: number): MapElement | null {
  const gj = el.geojson;
  if (!gj || typeof gj !== 'object') return null;
  if (gj.type === 'Polygon') {
    const outer = (gj.coordinates as number[][][])[0];
    const ring = toOpenRing(outer);
    if (ring.length < 3) return null;
    return {
      id: el.id,
      kind: el.kind,
      name: el.name ?? null,
      props: el.props ?? {},
      path: ringToPath(ring, maxY),
      isLine: false,
      labelCenter: flipPt(centroid(ring), maxY),
    };
  }
  if (gj.type === 'LineString') {
    const line = toOpenRing(gj.coordinates as number[][]);
    if (line.length < 2) return null;
    const mid = pointAtLength(line, chainLength(line) / 2).point;
    return {
      id: el.id,
      kind: el.kind,
      name: el.name ?? null,
      props: el.props ?? {},
      path: lineToPath(line, maxY),
      isLine: true,
      labelCenter: flipPt(mid, maxY),
    };
  }
  return null;
}

export function parseSnapshot(snap: GeometrySnapshot): ParsedGeometry {
  // Trust the snapshot bbox; recompute defensively when it is degenerate.
  let planBbox: [number, number, number, number];
  if (isFiniteBbox(snap.bbox)) {
    planBbox = [snap.bbox[0], snap.bbox[1], snap.bbox[2], snap.bbox[3]];
  } else {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const m of snap.manzanas ?? []) {
      for (const [x, y] of toOpenRing(m.ring)) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
    planBbox = Number.isFinite(x0) ? [x0, y0, x1, y1] : [0, 0, 100, 100];
  }
  const maxY = planBbox[3];

  const lots = new Map<string, MapLot>();
  const lotIdsByManzana = new Map<string, { id: string; number: string }[]>();
  for (const l of snap.lots ?? []) {
    const ring = toOpenRing(l.ring);
    if (ring.length < 3 || !l.id) continue;
    lots.set(l.id, {
      id: l.id,
      manzanaId: l.mz,
      number: String(l.n),
      frontage: l.f ?? null,
      depth: l.d ?? null,
      area: l.a,
      corner: !!l.corner,
      ring,
      path: ringToPath(ring, maxY),
      bbox: svgBbox(ring, maxY),
    });
    const list = lotIdsByManzana.get(l.mz) ?? [];
    list.push({ id: l.id, number: String(l.n) });
    lotIdsByManzana.set(l.mz, list);
  }

  const manzanas: MapManzana[] = [];
  for (const m of snap.manzanas ?? []) {
    const ring = toOpenRing(m.ring);
    if (ring.length < 3 || !m.id) continue;
    const children = (lotIdsByManzana.get(m.id) ?? []).sort((a, b) =>
      a.number.localeCompare(b.number, 'es', { numeric: true }),
    );
    manzanas.push({
      id: m.id,
      code: m.code,
      kind: m.kind,
      sector: m.sector ?? null,
      needsReview: !!m.needs_review,
      ring,
      path: ringToPath(ring, maxY),
      bbox: svgBbox(ring, maxY),
      lotIds: children.map((c) => c.id),
      labelCenter: flipPt(centroid(ring), maxY),
    });
  }

  const elements: MapElement[] = [];
  for (const el of snap.elements ?? []) {
    const parsed = parseElement(el, maxY);
    if (parsed) elements.push(parsed);
  }

  return {
    version: snap.v ?? 0,
    planBbox,
    maxY,
    lots,
    manzanas,
    elements,
  };
}
