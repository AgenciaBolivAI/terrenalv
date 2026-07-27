// Pure three.js geometry builders for the 3D scene. No React in this file.
//
// Coordinate contract: plan-space is meters, +X east, +Y north (y-up, see
// lib/types.ts). three.js world: x = planX, z = -planY, y = height/up. Shapes
// are built in plan XY and baked with rotateX(-PI/2) — (x, y, z) → (x, z, -y) —
// so meshes carry no runtime transforms and merge into single draw calls.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LotStatusEntry, MapElement, MapLot, MapManzana } from '../data/types';
import { bbox as ringBbox, ensureCCW } from '../lib/geom';
import type { Pt, Ring } from '../lib/types';
import {
  BILLBOARD_Y,
  GREEN_Y,
  LOT_BASE_Y,
  LOT_HEIGHT,
  PAD_AMENIDAD_HEX,
  PAD_EQUIPAMIENTO_HEX,
  PAD_Y,
  ROAD_Y,
  TERRAIN_AMPLITUDE,
  TERRAIN_GRASS_HIGH,
  TERRAIN_GRASS_LOW,
  lotColor,
} from './palette';

type Bbox = [number, number, number, number];

// ---------------------------------------------------------------------------
// SVG path → plan ring. The store keeps element geometry only as the SVG `d`
// string built by lib/path.ts (`M/L…Z`, y flipped as svgY = maxY − planY), so
// the 3D scene parses that exact format back. Rounding there is 1 cm — noise.
// ---------------------------------------------------------------------------
const PATH_TOKEN = /[ML]\s*(-?\d*\.?\d+(?:e-?\d+)?)[\s,]+(-?\d*\.?\d+(?:e-?\d+)?)/gi;

export function pathToPlanRing(path: string, maxY: number): Ring {
  const pts: Pt[] = [];
  PATH_TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATH_TOKEN.exec(path)) !== null) {
    pts.push([parseFloat(m[1]), maxY - parseFloat(m[2])]);
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Shapes / extrusion
// ---------------------------------------------------------------------------
function ringToShape(ring: Ring): THREE.Shape {
  const r = ensureCCW(ring);
  const shape = new THREE.Shape();
  shape.moveTo(r[0][0], r[0][1]);
  for (let i = 1; i < r.length; i++) shape.lineTo(r[i][0], r[i][1]);
  shape.closePath();
  return shape;
}

/** Extrude a plan ring straight up: base at `baseY`, top at `baseY + height`. */
export function extrudeRingGeometry(ring: Ring, height: number, baseY: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(ringToShape(ring), {
    depth: height,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 1,
  });
  geo.deleteAttribute('uv');
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, baseY, 0);
  return geo;
}

/** Flat (horizontal) polygon at height `y` from a plan ring. */
function flatRingGeometry(ring: Ring, y: number): THREE.BufferGeometry {
  const geo = new THREE.ShapeGeometry(ringToShape(ring), 1);
  geo.deleteAttribute('uv');
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  return geo;
}

function mergeAndDispose(geos: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!geos.length) return null;
  const merged = mergeGeometries(geos, false) as THREE.BufferGeometry | null;
  for (const g of geos) g.dispose();
  return merged;
}

/** Merge many plan rings into one flat mesh geometry (single draw call). */
export function buildFlatMerged(rings: Ring[], y: number): THREE.BufferGeometry | null {
  return mergeAndDispose(rings.filter((r) => r.length >= 3).map((r) => flatRingGeometry(r, y)));
}

/** Same, but with a constant per-ring vertex color (one material, many tints). */
export function buildFlatMergedColored(
  items: { ring: Ring; hex: string }[],
  y: number,
): THREE.BufferGeometry | null {
  const geos: THREE.BufferGeometry[] = [];
  const tmp = new THREE.Color();
  for (const { ring, hex } of items) {
    if (ring.length < 3) continue;
    const g = flatRingGeometry(ring, y);
    tmp.set(hex);
    const count = g.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geos.push(g);
  }
  return mergeAndDispose(geos);
}

// ---------------------------------------------------------------------------
// Terrain: one plane with gentle value-noise relief, flattened to 0 under all
// built footprints (manzana + element bboxes, per spec a bbox test suffices)
// with a smoothstep falloff so no cliffs form at the edges.
// ---------------------------------------------------------------------------
function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Two-octave value noise in [0, 1]. */
function relief(x: number, y: number): number {
  return 0.65 * valueNoise(x / 90, y / 90) + 0.35 * valueNoise(x / 33 + 13.7, y / 33 + 7.1);
}

export function buildTerrain(
  planBbox: Bbox,
  footprints: Bbox[],
  segments: number,
): THREE.BufferGeometry {
  const [x0, y0, x1, y1] = planBbox;
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  // +15% margin per side; never under 60 m so off-bbox elements (e.g. the
  // Ruta 9 strip south of the seed site) still sit on ground.
  const mx = Math.max(w * 0.15, 60);
  const my = Math.max(h * 0.15, 60);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;

  const geo = new THREE.PlaneGeometry(w + mx * 2, h + my * 2, segments, segments);
  geo.deleteAttribute('uv');
  geo.rotateX(-Math.PI / 2); // plane XY → ground XZ (z = -planY)
  geo.translate(cx, 0, -cy);

  const PAD = 4; // footprint safety margin (m)
  const FALLOFF = 26; // relief eases back in over this distance (m)
  const fp: Bbox[] = footprints.map(([a, b, c, d]) => [a - PAD, b - PAD, c + PAD, d + PAD]);

  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const count = pos.count;
  const colors = new Float32Array(count * 3);
  const cLow = new THREE.Color(TERRAIN_GRASS_LOW);
  const cHigh = new THREE.Color(TERRAIN_GRASS_HIGH);
  const tmp = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const px = pos.getX(i);
    const py = -pos.getZ(i); // back to plan Y
    let d2min = Infinity;
    for (const [a, b, c, d] of fp) {
      const dx = px < a ? a - px : px > c ? px - c : 0;
      const dy = py < b ? b - py : py > d ? py - d : 0;
      const d2 = dx * dx + dy * dy;
      if (d2 < d2min) {
        d2min = d2;
        if (d2 === 0) break;
      }
    }
    const t = Math.min(1, Math.sqrt(d2min) / FALLOFF);
    const ease = t * t * (3 - 2 * t);
    const height = relief(px, py) * TERRAIN_AMPLITUDE * ease;
    pos.setY(i, height);

    const k = Math.min(1, height / TERRAIN_AMPLITUDE);
    const jitter = 1 + (hash2(i, 9173) - 0.5) * 0.07; // subtle grass mottling
    tmp.copy(cLow).lerp(cHigh, k);
    colors[i * 3] = tmp.r * jitter;
    colors[i * 3 + 1] = tmp.g * jitter;
    colors[i * 3 + 2] = tmp.b * jitter;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// Ground composition: terrain + merged roads + merged greens + merged pads.
// ---------------------------------------------------------------------------
export interface GroundBuild {
  terrain: THREE.BufferGeometry;
  roads: THREE.BufferGeometry | null;
  greens: THREE.BufferGeometry | null;
  pads: THREE.BufferGeometry | null;
}

export function buildGround(args: {
  planBbox: Bbox;
  maxY: number;
  manzanas: MapManzana[];
  elements: MapElement[];
  terrainSegments: number;
}): GroundBuild {
  const { planBbox, maxY, manzanas, elements, terrainSegments } = args;
  const roadRings: Ring[] = [];
  const greenRings: Ring[] = [];
  const padItems: { ring: Ring; hex: string }[] = [];
  const footprints: Bbox[] = [];

  for (const m of manzanas) {
    if (m.ring.length < 3) continue;
    footprints.push(ringBbox(m.ring));
    if (m.kind === 'area_verde') greenRings.push(m.ring);
    else if (m.kind === 'amenidad') padItems.push({ ring: m.ring, hex: PAD_AMENIDAD_HEX });
    else if (m.kind === 'equipamiento') padItems.push({ ring: m.ring, hex: PAD_EQUIPAMIENTO_HEX });
  }

  for (const el of elements) {
    if (el.isLine) continue; // LineString elements have no pave-able area
    const ring = pathToPlanRing(el.path, maxY);
    if (ring.length < 3) continue;
    switch (el.kind) {
      case 'calle':
      case 'avenida':
      case 'ciclovia':
        roadRings.push(ring);
        footprints.push(ringBbox(ring));
        break;
      case 'area_verde':
        greenRings.push(ring);
        footprints.push(ringBbox(ring));
        break;
      case 'amenidad':
        padItems.push({ ring, hex: PAD_AMENIDAD_HEX });
        footprints.push(ringBbox(ring));
        break;
      case 'equipamiento':
        padItems.push({ ring, hex: PAD_EQUIPAMIENTO_HEX });
        footprints.push(ringBbox(ring));
        break;
      default:
        break; // perimetro / texto: no ground footprint
    }
  }

  return {
    terrain: buildTerrain(planBbox, footprints, terrainSegments),
    roads: buildFlatMerged(roadRings, ROAD_Y),
    greens: buildFlatMerged(greenRings, GREEN_Y),
    pads: buildFlatMergedColored(padItems, PAD_Y),
  };
}

// ---------------------------------------------------------------------------
// Lots: every ring extruded and merged into ONE geometry with per-vertex
// status colors + a parallel merged edge geometry for outlines. Ranges map
// lots ↔ vertex/triangle spans for imperative recolors and raycast picking.
// ---------------------------------------------------------------------------
export interface LotRange {
  start: number; // first vertex index in the merged geometry
  count: number; // vertex count
}

export interface TriRange {
  triStart: number;
  triEnd: number; // exclusive
  lotId: string;
}

export interface LotsBuild {
  geometry: THREE.BufferGeometry;
  outlineGeometry: THREE.BufferGeometry | null;
  lotRanges: Map<string, LotRange>;
  /** Sorted by triStart; merged geometry is non-indexed so faceIndex maps 1:1. */
  triRanges: TriRange[];
}

export function buildLots(
  lots: Iterable<MapLot>,
  statusByLotId: Record<string, LotStatusEntry>,
): LotsBuild | null {
  const fills: THREE.BufferGeometry[] = [];
  const edges: THREE.BufferGeometry[] = [];
  const ids: string[] = [];
  const counts: number[] = [];

  for (const lot of lots) {
    if (lot.ring.length < 3) continue;
    const g = extrudeRingGeometry(lot.ring, LOT_HEIGHT, LOT_BASE_Y);
    fills.push(g);
    edges.push(new THREE.EdgesGeometry(g, 25));
    ids.push(lot.id);
    counts.push(g.getAttribute('position').count);
  }
  if (!fills.length) return null;

  const geometry = mergeAndDispose(fills);
  const outlineGeometry = mergeAndDispose(edges);
  if (!geometry) {
    outlineGeometry?.dispose();
    return null;
  }

  const lotRanges = new Map<string, LotRange>();
  const triRanges: TriRange[] = [];
  let offset = 0;
  for (let i = 0; i < ids.length; i++) {
    lotRanges.set(ids[i], { start: offset, count: counts[i] });
    triRanges.push({ triStart: offset / 3, triEnd: (offset + counts[i]) / 3, lotId: ids[i] });
    offset += counts[i];
  }

  const colorAttr = new THREE.BufferAttribute(new Float32Array(offset * 3), 3);
  geometry.setAttribute('color', colorAttr);
  for (const [id, range] of lotRanges) {
    paintLotRange(colorAttr, range, lotColor(statusByLotId[id]));
  }

  return { geometry, outlineGeometry, lotRanges, triRanges };
}

/** Write one RGB into a lot's vertex span (caller sets needsUpdate + invalidate). */
export function paintLotRange(attr: THREE.BufferAttribute, range: LotRange, color: THREE.Color): void {
  const a = attr.array as Float32Array;
  const end = range.start + range.count;
  for (let i = range.start; i < end; i++) {
    a[i * 3] = color.r;
    a[i * 3 + 1] = color.g;
    a[i * 3 + 2] = color.b;
  }
}

/** faceIndex → lotId via binary search over the sorted triangle ranges. */
export function lotIdForFace(triRanges: TriRange[], faceIndex: number): string | null {
  let lo = 0;
  let hi = triRanges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = triRanges[mid];
    if (faceIndex < r.triStart) hi = mid - 1;
    else if (faceIndex >= r.triEnd) lo = mid + 1;
    else return r.lotId;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------
export interface BillboardInfo {
  id: string;
  name: string;
  position: [number, number, number];
}

/** Named amenity elements → billboard anchors (labelCenter is SVG-space). */
export function amenityBillboards(elements: MapElement[], maxY: number): BillboardInfo[] {
  const out: BillboardInfo[] = [];
  for (const el of elements) {
    if (el.kind !== 'amenidad' || !el.name || el.isLine) continue;
    // svgY = maxY − planY  ⇒  z = −planY = svgY − maxY.
    out.push({
      id: el.id,
      name: el.name,
      position: [el.labelCenter[0], BILLBOARD_Y, el.labelCenter[1] - maxY],
    });
  }
  return out;
}

/** Rounded-rect card (XY plane, faces +Z) for billboard labels. */
export function roundedRectGeometry(w: number, h: number, r: number): THREE.BufferGeometry {
  const hw = w / 2;
  const hh = h / 2;
  const s = new THREE.Shape();
  s.moveTo(-hw + r, -hh);
  s.lineTo(hw - r, -hh);
  s.quadraticCurveTo(hw, -hh, hw, -hh + r);
  s.lineTo(hw, hh - r);
  s.quadraticCurveTo(hw, hh, hw - r, hh);
  s.lineTo(-hw + r, hh);
  s.quadraticCurveTo(-hw, hh, -hw, hh - r);
  s.lineTo(-hw, -hh + r);
  s.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
  const g = new THREE.ShapeGeometry(s, 6);
  g.deleteAttribute('uv');
  return g;
}
