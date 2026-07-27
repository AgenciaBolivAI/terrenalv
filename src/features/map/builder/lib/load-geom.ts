// Geometry column values (PostgREST) → plan-space rings.
// Depending on the PostGIS/PostgREST combination, a `geometry` column arrives
// either as a GeoJSON object (PostGIS ≥3 registers a geometry→json cast) or as
// an EWKB hex string. Handle both so the Builder never depends on stack details.

import type { Pt, Ring } from '../../lib/types';

/** Drop the GeoJSON closing point; keep the open-ring contract. */
export function toOpenRing(raw: unknown): Ring {
  if (!Array.isArray(raw)) return [];
  const pts: Pt[] = [];
  for (const p of raw) {
    if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
      pts.push([Number(p[0]), Number(p[1])]);
    }
  }
  if (pts.length >= 2) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) {
      pts.pop();
    }
  }
  return pts;
}

interface GeoJsonLike {
  type?: string;
  coordinates?: unknown;
}

function geoJsonToRing(g: GeoJsonLike): Ring | null {
  if (g.type === 'Polygon' && Array.isArray(g.coordinates)) {
    const ring = toOpenRing((g.coordinates as unknown[])[0]);
    return ring.length >= 3 ? ring : null;
  }
  if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
    const first = (g.coordinates as unknown[])[0];
    if (Array.isArray(first)) {
      const ring = toOpenRing((first as unknown[])[0]);
      return ring.length >= 3 ? ring : null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Minimal (E)WKB reader — Polygon / MultiPolygon outer ring only.
// ---------------------------------------------------------------------------

class WkbReader {
  private view: DataView;
  private offset = 0;

  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private little = true;

  private u8(): number {
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  private u32(): number {
    const v = this.view.getUint32(this.offset, this.little);
    this.offset += 4;
    return v;
  }

  private f64(): number {
    const v = this.view.getFloat64(this.offset, this.little);
    this.offset += 8;
    return v;
  }

  /** Reads one geometry header + body; returns the outer ring of the first polygon. */
  readPolygonRing(): Ring | null {
    this.little = this.u8() === 1;
    let type = this.u32();
    const hasZ = (type & 0x80000000) !== 0;
    const hasM = (type & 0x40000000) !== 0;
    const hasSrid = (type & 0x20000000) !== 0;
    if (hasSrid) this.u32(); // skip SRID
    type = type & 0x1fffffff;
    // ISO WKB encodes dimensionality as +1000/+2000/+3000.
    let isoDims = 0;
    if (type >= 3000) {
      type -= 3000;
      isoDims = 2;
    } else if (type >= 2000) {
      type -= 2000;
      isoDims = 1;
    } else if (type >= 1000) {
      type -= 1000;
      isoDims = 1;
    }
    const extra = (hasZ ? 1 : 0) + (hasM ? 1 : 0) + isoDims;

    if (type === 6) {
      // MultiPolygon: number of polygons, then nested full geometries.
      const n = this.u32();
      if (n < 1) return null;
      return this.readPolygonRing();
    }
    if (type !== 3) return null; // not a polygon

    const numRings = this.u32();
    if (numRings < 1) return null;
    const numPoints = this.u32();
    if (numPoints < 3 || numPoints > 100000) return null;
    const pts: Pt[] = [];
    for (let i = 0; i < numPoints; i++) {
      const x = this.f64();
      const y = this.f64();
      for (let d = 0; d < extra; d++) this.f64();
      pts.push([x, y]);
    }
    return toOpenRing(pts);
  }
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length < 18 || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const b = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(b)) return null;
    out[i] = b;
  }
  return out;
}

/** Any PostgREST representation of a polygon geometry → open Ring (or null). */
export function geomToRing(value: unknown): Ring | null {
  if (value == null) return null;
  if (typeof value === 'object') {
    return geoJsonToRing(value as GeoJsonLike);
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (s.startsWith('{')) {
      try {
        return geoJsonToRing(JSON.parse(s) as GeoJsonLike);
      } catch {
        return null;
      }
    }
    if (/^[0-9a-fA-F]+$/.test(s)) {
      const bytes = hexToBytes(s);
      if (!bytes) return null;
      try {
        const ring = new WkbReader(bytes).readPolygonRing();
        return ring && ring.length >= 3 ? ring : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function ringsEqual(a: Ring | null, b: Ring | null, eps = 1e-6): boolean {
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i][0] - b[i][0]) > eps || Math.abs(a[i][1] - b[i][1]) > eps) return false;
  }
  return true;
}
