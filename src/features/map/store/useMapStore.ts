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

export type LotLiveState = LotStatusEntry;

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

  /** lotId → manzanaId, built once with the geometry (culling + stats). */
  lotManzana: Map<string, string>;
  /**
   * Per-manzana availability, recomputed ONLY when statuses change. Previously
   * every ManzanaGroup looped its own lot ids inside a selector, so any store
   * write — including one viewportBbox update per zoom frame — cost ~6k
   * iterations across the 96 groups.
   */
  manzanaStats: Record<string, { total: number; disponibles: number; priced: number }>;

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
  /**
   * La camara, publicada por PlanViewport para que cualquier capa del plano
   * pueda pedirle que se acerque. Antes solo la tenia el buscador, via ref, y
   * por eso la manzana no podia reaccionar a un toque.
   */
  acercarAManzana: ((manzanaId: string) => void) | null;
  setAcercarAManzana: (fn: ((manzanaId: string) => void) | null) => void;
}

type Stats = Record<string, { total: number; disponibles: number; priced: number }>;

/** One pass over all lots — replaces per-manzana loops running inside selectors. */
function computeStats(manzanas: MapManzana[], byLot: Record<string, LotLiveState>): Stats {
  const out: Stats = {};
  for (const m of manzanas) {
    let disponibles = 0;
    let priced = 0;
    for (const id of m.lotIds) {
      const e = byLot[id];
      if (!e) continue;
      if (e.priced) priced++;
      if (e.st === 'disponible' && e.priced) disponibles++;
    }
    out[m.id] = { total: m.lotIds.length, disponibles, priced };
  }
  return out;
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
    lotManzana: new Map(),
    manzanaStats: {},
    setGeometry: (g) => {
      const lotManzana = new Map<string, string>();
      for (const m of g.manzanas) {
        for (const id of m.lotIds) lotManzana.set(id, m.id);
      }
      set({
        lotManzana,
        ready: true,
        geometryVersion: g.geometryVersion,
        planBbox: g.planBbox,
        maxY: g.maxY,
        svgSize: [g.planBbox[2] - g.planBbox[0], g.planBbox[3] - g.planBbox[1]],
        lots: g.lots,
        manzanas: g.manzanas,
        elements: g.elements,
        manzanaStats: computeStats(g.manzanas, get().statusByLotId),
      });
    },

    statusRev: 0,
    statusByLotId: {},
    serverNow: null,
    applyStatusSnapshot: (rev, serverNow, entries) => {
      // Monotonicity guard: a slow in-flight snapshot must never overwrite newer
      // state that broadcasts already applied (stale response ordering).
      if (rev < get().statusRev) return;
      const map: Record<string, LotLiveState> = {};
      for (const e of entries) map[e.id] = { st: e.st, priced: e.priced, price: e.price };
      set({
        statusRev: rev,
        serverNow,
        statusByLotId: map,
        needsStatusResync: false,
        manzanaStats: computeStats(get().manzanas, map),
      });
    },
    applyStatusEvent: (lotId, status, rev) => {
      const { statusRev, statusByLotId } = get();
      // Old/replayed event: ignore rather than resurrect a superseded status.
      if (rev <= statusRev) return;
      if (rev > statusRev + 1) {
        // Missed events (tab sleep / reconnect). Apply this one anyway — it IS
        // the newest known truth for this lot — but flag a snapshot refetch to
        // recover the lots whose events we never saw.
        set({ needsStatusResync: true });
      }
      const prev = statusByLotId[lotId];
      const next = { st: status, priced: prev?.priced ?? false, price: prev?.price ?? null };
      const patch: Partial<MapState> = {
        statusRev: Math.max(rev, statusRev),
        statusByLotId: { ...statusByLotId, [lotId]: next },
      };
      // Only the affected manzana's counters move — no full recompute.
      const mzId = get().lotManzana.get(lotId);
      if (mzId) {
        const stats = get().manzanaStats;
        const cur = stats[mzId];
        if (cur) {
          const wasAvail = prev?.st === 'disponible' && prev?.priced;
          const isAvail = next.st === 'disponible' && next.priced;
          if (wasAvail !== isAvail) {
            patch.manzanaStats = {
              ...stats,
              [mzId]: { ...cur, disponibles: cur.disponibles + (isAvail ? 1 : -1) },
            };
          }
        }
      }
      set(patch);
    },
    needsStatusResync: false,
    setNeedsStatusResync: (v) => set({ needsStatusResync: v }),

    viewMode: '2d',
    acercarAManzana: null,
    setAcercarAManzana: (fn) => set({ acercarAManzana: fn }),
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
