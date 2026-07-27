// Headless tests for the pure 3D geometry builders: coordinate mapping,
// merged-lot vertex/triangle ranges, raycast picking, status recolors, and
// terrain flattening. No WebGL involved — everything here is CPU geometry.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { LotStatusEntry, MapElement, MapLot, MapManzana } from '../data/types';
import { centroid } from '../lib/geom';
import { ringToPath } from '../lib/path';
import type { Ring } from '../lib/types';
import { LOT_STATUS_HEX, lotColor } from './palette';
import {
  buildGround,
  buildLots,
  lotIdForFace,
  paintLotRange,
  pathToPlanRing,
} from './world';

const MAX_Y = 100;

function makeLot(id: string, ring: Ring): MapLot {
  return {
    id,
    manzanaId: 'mz-1',
    number: id,
    frontage: 10,
    depth: 20,
    area: 200,
    corner: false,
    ring,
    path: ringToPath(ring, MAX_Y),
    bbox: [0, 0, 1, 1],
  };
}

const rect = (x: number, y: number, w: number, h: number): Ring => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

describe('pathToPlanRing', () => {
  it('round-trips ringToPath within 1 cm', () => {
    const ring: Ring = [
      [12.34, 56.78],
      [40.01, 55.5],
      [39.99, 80.123],
      [11.5, 79.9],
    ];
    const back = pathToPlanRing(ringToPath(ring, MAX_Y), MAX_Y);
    expect(back.length).toBe(ring.length);
    for (let i = 0; i < ring.length; i++) {
      expect(back[i][0]).toBeCloseTo(ring[i][0], 2);
      expect(back[i][1]).toBeCloseTo(ring[i][1], 2);
    }
  });
});

describe('buildLots', () => {
  const lots = [
    makeLot('a', rect(0, 0, 10, 20)),
    makeLot('b', rect(10, 0, 10, 20)),
    makeLot('c', rect(20, 0, 12, 20)),
  ];
  const statuses: Record<string, LotStatusEntry> = {
    a: { st: 'disponible', priced: true, price: 100 },
    b: { st: 'reservado', priced: true, price: 100 },
    c: { st: 'vendido', priced: false, price: null },
  };
  const build = buildLots(lots, statuses)!;

  it('merges into contiguous vertex ranges covering the whole buffer', () => {
    expect(build).not.toBeNull();
    const total = build.geometry.getAttribute('position').count;
    let offset = 0;
    for (const id of ['a', 'b', 'c']) {
      const r = build.lotRanges.get(id)!;
      expect(r.start).toBe(offset);
      offset += r.count;
    }
    expect(offset).toBe(total);
    expect(build.geometry.getIndex()).toBeNull(); // faceIndex must map 1:1
  });

  it('maps world coordinates as x=planX, z=-planY, y=up', () => {
    const pos = build.geometry.getAttribute('position') as THREE.BufferAttribute;
    const bb = new THREE.Box3().setFromBufferAttribute(pos);
    // Plan x ∈ [0,32], y ∈ [0,20] → world x ∈ [0,32], z ∈ [-20,0], y ∈ [0.02,0.17].
    expect(bb.min.x).toBeCloseTo(0, 5);
    expect(bb.max.x).toBeCloseTo(32, 5);
    expect(bb.min.z).toBeCloseTo(-20, 5);
    expect(bb.max.z).toBeCloseTo(0, 5);
    expect(bb.min.y).toBeCloseTo(0.02, 5);
    expect(bb.max.y).toBeCloseTo(0.17, 5);
  });

  it('picks the right lot via raycast faceIndex → binary search', () => {
    const mesh = new THREE.Mesh(build.geometry, new THREE.MeshBasicMaterial());
    for (const lot of lots) {
      const [cx, cy] = centroid(lot.ring);
      const ray = new THREE.Raycaster(new THREE.Vector3(cx, 50, -cy), new THREE.Vector3(0, -1, 0));
      const hits = ray.intersectObject(mesh);
      expect(hits.length).toBeGreaterThan(0);
      expect(lotIdForFace(build.triRanges, hits[0].faceIndex!)).toBe(lot.id);
    }
    expect(lotIdForFace(build.triRanges, 1e9)).toBeNull();
  });

  it('paints initial status colors and patches a single range on update', () => {
    const attr = build.geometry.getAttribute('color') as THREE.BufferAttribute;
    const expectRangeColor = (id: string, hex: string) => {
      const c = new THREE.Color(hex);
      const r = build.lotRanges.get(id)!;
      for (const i of [r.start, r.start + r.count - 1]) {
        expect(attr.getX(i)).toBeCloseTo(c.r, 5);
        expect(attr.getY(i)).toBeCloseTo(c.g, 5);
        expect(attr.getZ(i)).toBeCloseTo(c.b, 5);
      }
    };
    expectRangeColor('a', LOT_STATUS_HEX.disponible);
    expectRangeColor('b', LOT_STATUS_HEX.reservado);
    expectRangeColor('c', LOT_STATUS_HEX.vendido);

    // Live flip: b → vendido. Only b's range may change.
    paintLotRange(attr, build.lotRanges.get('b')!, lotColor({ st: 'vendido', priced: true, price: 1 }));
    expectRangeColor('a', LOT_STATUS_HEX.disponible);
    expectRangeColor('b', LOT_STATUS_HEX.vendido);
    expectRangeColor('c', LOT_STATUS_HEX.vendido);
  });

  it('resolves the sin-precio tint for unpriced disponible lots', () => {
    const c = lotColor({ st: 'disponible', priced: false, price: null });
    expect(c.getHexString()).toBe(new THREE.Color(LOT_STATUS_HEX.disponibleSinPrecio).getHexString());
  });
});

describe('buildGround', () => {
  const manzana: MapManzana = {
    id: 'mz-1',
    code: 'A',
    kind: 'residencial',
    sector: null,
    needsReview: false,
    ring: rect(40, 40, 60, 40),
    path: ringToPath(rect(40, 40, 60, 40), MAX_Y),
    bbox: [40, 20, 100, 60],
    lotIds: [],
    labelCenter: [70, 40],
  };
  const roadRing = rect(0, 20, 200, 10);
  const road: MapElement = {
    id: 'el-1',
    kind: 'calle',
    name: null,
    props: {},
    path: ringToPath(roadRing, MAX_Y),
    isLine: false,
    labelCenter: [100, 75],
  };
  const ground = buildGround({
    planBbox: [0, 0, 200, 100],
    maxY: MAX_Y,
    manzanas: [manzana],
    elements: [road],
    terrainSegments: 96,
  });

  it('flattens terrain to 0 under manzana and road footprints, relief elsewhere', () => {
    const pos = ground.terrain.getAttribute('position') as THREE.BufferAttribute;
    let maxInsideMz = 0;
    let maxInsideRoad = 0;
    let maxOutside = 0;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = -pos.getZ(i);
      const h = pos.getY(i);
      if (px >= 40 && px <= 100 && py >= 40 && py <= 80) maxInsideMz = Math.max(maxInsideMz, h);
      else if (px >= 0 && px <= 200 && py >= 20 && py <= 30) maxInsideRoad = Math.max(maxInsideRoad, h);
      else maxOutside = Math.max(maxOutside, h);
    }
    expect(maxInsideMz).toBe(0);
    expect(maxInsideRoad).toBe(0);
    expect(maxOutside).toBeGreaterThan(0.3);
    expect(maxOutside).toBeLessThanOrEqual(1.5);
  });

  it('parses the road element back from its SVG path into a floated mesh', () => {
    expect(ground.roads).not.toBeNull();
    const pos = ground.roads!.getAttribute('position') as THREE.BufferAttribute;
    const bb = new THREE.Box3().setFromBufferAttribute(pos);
    expect(bb.min.y).toBeCloseTo(0.05, 5);
    expect(bb.max.y).toBeCloseTo(0.05, 5);
    expect(bb.min.x).toBeCloseTo(0, 2);
    expect(bb.max.x).toBeCloseTo(200, 2);
    expect(bb.min.z).toBeCloseTo(-30, 2);
    expect(bb.max.z).toBeCloseTo(-20, 2);
  });
});
