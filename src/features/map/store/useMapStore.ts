'use client';

// Single source of truth shared by the 2D SVG plat and the 3D scene.
//  * 2D LotPath components subscribe per-lot → one broadcast re-renders one path.
//  * 3D LotsMergedMesh uses store.subscribe (transient, outside React) and patches
//    vertex colors imperatively — zero React reconciliation in the 3D hot path.

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { LotStatus } from '@/lib/db-types';
import type { LotStatusEntry, MapElement, MapLot, MapManzana } from '../data/types';

export type ViewMode = '2d' | '3d';
export type LodBucket = 0 | 1 | 2;

export interface LotLiveState extends LotStatusEntry {}

interface MapState {
  // Geometry (write-once at load)
  ready: boolean;
  geometryVersion: number;
  planBbox: [number, number, number, number];
  svgSize: [number, number];
  maxY: number;
  lots: Map<string, MapLot>;
  manzanas: MapManzana[];
  elements: MapElement[];
  setGeometry: (g: {
    geometryVersion: number;
    planBbox: [number, number, number, number];
    maxY: number;
    lots: Map<string, MapLot>;
    manzanas: MapManzana[];
    elements: MapElement[];
  }) => void;

  // Hot status state
  statusRev: number;
  statusByLotId: Record<string, LotLiveState>;
  serverNow: string | null;
  applyStatusSnapshot: (rev: number, serverNow: string, entries: ({ id: string } & LotStatusEntry)[]) => void;
  applyStatusEvent: (lotId: string, status: LotStatus, rev: number) => void;
  /** Set by the realtime hook when a rev gap is detected → loaders refetch. */
  needsStatusResync: boolean;
  setNeedsStatusResync: (v: boolean) => void;

  // UI state
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  selectedLotId: string | null;
  selectLot: (id: string | null) => void;
  lodBucket: LodBucket;
  setLodBucket: (b: LodBucket) => void;
  viewportBbox: [number, number, number, number] | null;
  setViewportBbox: (b: [number, number, number, number]) => void;
}

export const useMapStore = create<MapState>()(
  subscribeWithSelector((set, get) => ({
    ready: false,
    geometryVersion: 0,
    planBbox: [0, 0, 0, 0],
    svgSize: [0, 0],
    maxY: 0,
    lots: new Map(),
    manzanas: [],
    elements: [],
    setGeometry: (g) =>
      set({
        ready: true,
        geometryVersion: g.geometryVersion,
        planBbox: g.planBbox,
        maxY: g.maxY,
        svgSize: [g.planBbox[2] - g.planBbox[0], g.planBbox[3] - g.planBbox[1]],
        lots: g.lots,
        manzanas: g.manzanas,
        elements: g.elements,
      }),

    statusRev: 0,
    statusByLotId: {},
    serverNow: null,
    applyStatusSnapshot: (rev, serverNow, entries) => {
      const map: Record<string, LotLiveState> = {};
      for (const e of entries) map[e.id] = { st: e.st, priced: e.priced, price: e.price };
      set({ statusRev: rev, serverNow, statusByLotId: map, needsStatusResync: false });
    },
    applyStatusEvent: (lotId, status, rev) => {
      const { statusRev, statusByLotId } = get();
      if (rev > statusRev + 1) {
        // Missed events (tab sleep / reconnect) → snapshot refetch.
        set({ needsStatusResync: true });
        return;
      }
      const prev = statusByLotId[lotId];
      set({
        statusRev: Math.max(rev, statusRev),
        statusByLotId: {
          ...statusByLotId,
          [lotId]: { st: status, priced: prev?.priced ?? false, price: prev?.price ?? null },
        },
      });
    },
    needsStatusResync: false,
    setNeedsStatusResync: (v) => set({ needsStatusResync: v }),

    viewMode: '2d',
    setViewMode: (m) => set({ viewMode: m }),
    selectedLotId: null,
    selectLot: (id) => set({ selectedLotId: id }),
    lodBucket: 0,
    setLodBucket: (b) => set({ lodBucket: b }),
    viewportBbox: null,
    setViewportBbox: (b) => set({ viewportBbox: b }),
  })),
);

/** Availability aggregate per manzana (for LOD-0 coloring). */
export function manzanaAggregate(
  m: MapManzana,
  statusByLotId: Record<string, LotLiveState>,
): { total: number; disponibles: number } {
  let disponibles = 0;
  for (const id of m.lotIds) {
    if (statusByLotId[id]?.st === 'disponible' && statusByLotId[id]?.priced) disponibles++;
  }
  return { total: m.lotIds.length, disponibles };
}
