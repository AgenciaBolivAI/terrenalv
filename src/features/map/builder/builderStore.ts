'use client';

// Draft state for the admin Map Builder — deliberately separate from
// useMapStore (the public viewer): different lifecycle (drafts, undo, dirty
// tracking) and different data source (authed client; team RLS sees drafts).
//
// Undo model: every geometry mutation goes through commit()/commitTransient(),
// which push inverse patches of the two draft slices (draftRing, draftLots)
// onto a session-local stack. Drag interactions write transiently and push a
// single command on pointer-up.

import { create } from 'zustand';
import { createClient } from '@/lib/supabase/client';
import { traerTodo } from '@/features/admin/lib/traer-todo';
import type { LotStatus, ManzanaKind } from '@/lib/db-types';
import type { Affine } from '../lib/affine';
import { ensureCCW, roundPt } from '../lib/geom';
import type { GeneratedLot, Pt, Ring } from '../lib/types';
import { geomToRing } from './lib/load-geom';
import { hintFromSpec, specFromJson, DEFAULT_SPEC, type SpecDraft } from './lib/spec';

export type BuilderTool = 'select' | 'draw' | 'subdivide' | 'vertex' | 'cutline';
export type GeomStateKind = 'draft' | 'published';

export interface BuilderManzana {
  id: string; // real uuid, or `new-…` until first save
  isNew: boolean;
  code: string;
  kind: ManzanaKind;
  sector: string | null;
  state: GeomStateKind;
  needs_review: boolean;
  version: number;
  subdivision_spec: Record<string, unknown> | null;
  ring: Ring | null;
}

export interface DraftLot {
  key: string; // stable client key
  id: string | null; // null = never saved
  number: string;
  ring: Ring;
  /** Ring as loaded from the DB (null for new lots) — drives edge_dims passthrough. */
  sourceRing: Ring | null;
  frontage_m: number | null;
  depth_m: number | null;
  /** Official (printed) area — the legal/pricing number. */
  area_m2: number;
  is_corner: boolean;
  is_manual_geom: boolean;
  needs_review: boolean;
  status: LotStatus;
  state: GeomStateKind;
  edge_dims: unknown;
}

export interface PlanoUnderlay {
  sheetId: string;
  url: string;
  widthPx: number;
  heightPx: number;
  affine: Affine; // raw pixel → plan meters
}

export interface DraftPatch {
  draftRing?: Ring | null;
  draftLots?: DraftLot[];
}

interface Command {
  label: string;
  before: DraftPatch;
  after: DraftPatch;
}

export interface SubdividePreview {
  lots: GeneratedLot[];
  warnings: string[];
  leftoverA: number;
  leftoverB: number;
}

const UNDO_LIMIT = 60;

let lotKeySeq = 1;
export function newLotKey(): string {
  return `dl-${lotKeySeq++}-${Math.random().toString(36).slice(2, 8)}`;
}

function sortLots(lots: DraftLot[]): DraftLot[] {
  return [...lots].sort((a, b) => a.number.localeCompare(b.number, 'es', { numeric: true }));
}

interface LotRowFromDb {
  id: string;
  number: string;
  status: LotStatus;
  state: string;
  frontage_m: number | string | null;
  depth_m: number | string | null;
  area_m2: number | string;
  is_corner: boolean;
  is_manual_geom: boolean;
  needs_review: boolean;
  edge_dims: unknown;
  geom: unknown;
}

interface ManzanaRowFromDb {
  id: string;
  code: string;
  kind: ManzanaKind;
  sector: string | null;
  state: string;
  needs_review: boolean;
  version: number;
  subdivision_spec: Record<string, unknown> | null;
  geom: unknown;
}

function numOrNull(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

interface BuilderState {
  projectId: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  loadError: string | null;
  manzanas: BuilderManzana[];
  lotStats: Record<string, { count: number; review: boolean }>;
  planBbox: [number, number, number, number];
  maxY: number;

  // Selected manzana draft
  selectedId: string | null;
  loadingLots: boolean;
  baseVersion: number | null;
  draftRing: Ring | null;
  draftLots: DraftLot[];
  dirtyManzana: boolean; // outline or meta changed since load/save
  dirtyLots: boolean;

  // Tooling
  tool: BuilderTool;
  snapEnabled: boolean;
  selectedLotKey: string | null;
  /** lotKey === null → vertex of the manzana outline. */
  selectedVertex: { lotKey: string | null; index: number } | null;
  drawPoints: Pt[];
  preview: SubdividePreview | null;
  specDraft: SpecDraft;
  sideAHint: Pt | null;
  pickingSideA: boolean;

  // Plano underlay
  underlay: PlanoUnderlay | null;
  underlayOpacity: number;
  underlayVisible: boolean;

  undoStack: Command[];
  redoStack: Command[];

  // ---- actions ----
  init: (projectId: string) => Promise<void>;
  refresh: () => Promise<void>;
  selectManzana: (id: string | null) => Promise<void>;
  reloadSelectedLots: () => Promise<void>;
  createManzana: (meta: { code: string; kind: ManzanaKind; sector: string | null }) => void;
  updateManzanaMeta: (patch: Partial<Pick<BuilderManzana, 'kind' | 'sector' | 'needs_review'>>) => void;
  discardNewManzana: (id: string) => void;
  markManzanaSaved: (oldId: string, saved: { id: string; version: number }) => void;

  commit: (label: string, patch: DraftPatch) => void;
  setTransient: (patch: DraftPatch) => void;
  commitTransient: (label: string, before: DraftPatch) => void;
  undo: () => void;
  redo: () => void;

  setTool: (t: BuilderTool) => void;
  setSnapEnabled: (v: boolean) => void;
  selectLot: (key: string | null) => void;
  selectVertex: (v: { lotKey: string | null; index: number } | null) => void;
  setDrawPoints: (pts: Pt[]) => void;
  /** Close the in-progress outline (≥3 points) into the draft ring. */
  closeDrawRing: () => void;
  setPreview: (p: SubdividePreview | null) => void;
  setSpecDraft: (patch: Partial<SpecDraft>) => void;
  setSideAHint: (p: Pt | null) => void;
  setPickingSideA: (v: boolean) => void;

  setUnderlay: (u: PlanoUnderlay | null) => void;
  setUnderlayOpacity: (v: number) => void;
  setUnderlayVisible: (v: boolean) => void;
}

function computeBbox(manzanas: BuilderManzana[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const m of manzanas) {
    for (const [x, y] of m.ring ?? []) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (!Number.isFinite(x0) || x1 - x0 < 1 || y1 - y0 < 1) return [0, 0, 400, 400];
  return [x0, y0, x1, y1];
}

export const useBuilderStore = create<BuilderState>()((set, get) => ({
  projectId: null,
  status: 'idle',
  loadError: null,
  manzanas: [],
  lotStats: {},
  planBbox: [0, 0, 400, 400],
  maxY: 400,

  selectedId: null,
  loadingLots: false,
  baseVersion: null,
  draftRing: null,
  draftLots: [],
  dirtyManzana: false,
  dirtyLots: false,

  tool: 'select',
  snapEnabled: true,
  selectedLotKey: null,
  selectedVertex: null,
  drawPoints: [],
  preview: null,
  specDraft: { ...DEFAULT_SPEC },
  sideAHint: null,
  pickingSideA: false,

  underlay: null,
  underlayOpacity: 0.5,
  underlayVisible: false,

  undoStack: [],
  redoStack: [],

  init: async (projectId) => {
    set({ projectId, status: 'loading', loadError: null });
    const supabase = createClient();
    try {
      const [mzRes, lotRes] = await Promise.all([
        supabase
          .from('manzanas')
          .select('id, code, kind, sector, state, needs_review, version, subdivision_spec, geom')
          .eq('project_id', projectId)
          .order('code')
          .limit(2000),
        // Paginado: son los lotes de TODA la urbanización (2.078 hoy) y de acá
        // sale el contador de «necesitan revisión» por manzana. Con el tope de
        // 1.000 de PostgREST, las manzanas del final quedaban en cero.
        traerTodo<{ manzana_id: string; needs_review: boolean }>((desde, hasta) =>
          supabase
            .from('lots')
            .select('manzana_id, needs_review')
            .eq('project_id', projectId)
            .is('deleted_at', null)
            .order('id')
            .range(desde, hasta),
        ).then((data) => ({ data, error: null })),
      ]);
      if (mzRes.error) {
        set({ status: 'error', loadError: mzRes.error.message });
        return;
      }
      const manzanas: BuilderManzana[] = ((mzRes.data ?? []) as unknown as ManzanaRowFromDb[]).map(
        (r) => ({
          id: r.id,
          isNew: false,
          code: r.code,
          kind: r.kind,
          sector: r.sector,
          state: r.state === 'published' ? 'published' : 'draft',
          needs_review: !!r.needs_review,
          version: Number(r.version) || 1,
          subdivision_spec: r.subdivision_spec ?? null,
          ring: geomToRing(r.geom),
        }),
      );
      const lotStats: Record<string, { count: number; review: boolean }> = {};
      for (const row of (lotRes.data ?? []) as { manzana_id: string; needs_review: boolean }[]) {
        const s = lotStats[row.manzana_id] ?? { count: 0, review: false };
        s.count += 1;
        if (row.needs_review) s.review = true;
        lotStats[row.manzana_id] = s;
      }
      const planBbox = computeBbox(manzanas);
      set({ status: 'ready', manzanas, lotStats, planBbox, maxY: planBbox[3] });

      // Best-effort: preload the latest calibrated plano as an (hidden) underlay.
      if (!get().underlay) {
        try {
          const { data: sheets } = await supabase
            .from('plano_sheets')
            .select('id, storage_path, width_px, height_px, px_to_plan')
            .eq('project_id', projectId)
            .not('px_to_plan', 'is', null)
            .order('created_at', { ascending: false })
            .limit(1);
          const sheet = sheets?.[0];
          if (sheet?.px_to_plan && sheet.width_px && sheet.height_px) {
            const { data: signed } = await supabase.storage
              .from('planos')
              .createSignedUrl(sheet.storage_path as string, 60 * 60 * 8);
            if (signed?.signedUrl) {
              set({
                underlay: {
                  sheetId: sheet.id as string,
                  url: signed.signedUrl,
                  widthPx: Number(sheet.width_px),
                  heightPx: Number(sheet.height_px),
                  affine: sheet.px_to_plan as unknown as Affine,
                },
              });
            }
          }
        } catch {
          // underlay is optional
        }
      }
    } catch (e) {
      set({ status: 'error', loadError: e instanceof Error ? e.message : 'error' });
    }
  },

  refresh: async () => {
    const { projectId, selectedId } = get();
    if (!projectId) return;
    await get().init(projectId);
    if (selectedId && get().manzanas.some((m) => m.id === selectedId)) {
      await get().selectManzana(selectedId);
    }
  },

  selectManzana: async (id) => {
    const mz = id ? get().manzanas.find((m) => m.id === id) ?? null : null;
    set({
      selectedId: mz?.id ?? null,
      draftRing: mz?.ring ? mz.ring.map((p) => [p[0], p[1]] as Pt) : null,
      draftLots: [],
      baseVersion: mz && !mz.isNew ? mz.version : null,
      dirtyManzana: mz?.isNew ?? false,
      dirtyLots: false,
      loadingLots: !!mz && !mz.isNew,
      undoStack: [],
      redoStack: [],
      selectedLotKey: null,
      selectedVertex: null,
      drawPoints: [],
      preview: null,
      specDraft: specFromJson(mz?.subdivision_spec),
      sideAHint: hintFromSpec(mz?.subdivision_spec, mz?.ring ?? null),
      pickingSideA: false,
    });
    if (!mz || mz.isNew) return;

    const supabase = createClient();
    const { data, error } = await supabase
      .from('lots')
      .select(
        'id, number, status, state, frontage_m, depth_m, area_m2, is_corner, is_manual_geom, needs_review, edge_dims, geom',
      )
      .eq('manzana_id', mz.id)
      .is('deleted_at', null)
      .limit(2000);
    if (get().selectedId !== mz.id) return; // stale response
    if (error) {
      set({ loadingLots: false });
      return;
    }
    const lots: DraftLot[] = [];
    for (const r of (data ?? []) as unknown as LotRowFromDb[]) {
      const ring = geomToRing(r.geom);
      if (!ring) continue;
      lots.push({
        key: r.id,
        id: r.id,
        number: String(r.number),
        ring,
        sourceRing: ring,
        frontage_m: numOrNull(r.frontage_m),
        depth_m: numOrNull(r.depth_m),
        area_m2: numOrNull(r.area_m2) ?? 0,
        is_corner: !!r.is_corner,
        is_manual_geom: !!r.is_manual_geom,
        needs_review: !!r.needs_review,
        status: r.status,
        state: r.state === 'published' ? 'published' : 'draft',
        edge_dims: r.edge_dims ?? null,
      });
    }
    set({ draftLots: sortLots(lots), loadingLots: false });
  },

  reloadSelectedLots: async () => {
    const id = get().selectedId;
    if (!id) return;
    await get().selectManzana(id);
  },

  createManzana: (meta) => {
    const id = `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const mz: BuilderManzana = {
      id,
      isNew: true,
      code: meta.code,
      kind: meta.kind,
      sector: meta.sector,
      state: 'draft',
      needs_review: false,
      version: 0,
      subdivision_spec: null,
      ring: null,
    };
    set((s) => ({
      manzanas: [...s.manzanas, mz].sort((a, b) =>
        a.code.localeCompare(b.code, 'es', { numeric: true }),
      ),
    }));
    void get().selectManzana(id);
    set({ tool: 'draw' });
  },

  updateManzanaMeta: (patch) => {
    const { selectedId } = get();
    if (!selectedId) return;
    set((s) => ({
      manzanas: s.manzanas.map((m) => (m.id === selectedId ? { ...m, ...patch } : m)),
      dirtyManzana: true,
    }));
  },

  discardNewManzana: (id) => {
    set((s) => ({ manzanas: s.manzanas.filter((m) => m.id !== id) }));
    if (get().selectedId === id) void get().selectManzana(null);
  },

  markManzanaSaved: (oldId, saved) => {
    const s = get();
    const ring = s.draftRing;
    set({
      manzanas: s.manzanas.map((m) =>
        m.id === oldId
          ? { ...m, id: saved.id, isNew: false, version: saved.version, state: 'draft', ring }
          : m,
      ),
      selectedId: s.selectedId === oldId ? saved.id : s.selectedId,
      baseVersion: saved.version,
      dirtyManzana: false,
    });
  },

  commit: (label, patch) => {
    const s = get();
    const before: DraftPatch = {};
    const after: DraftPatch = {};
    if ('draftRing' in patch) {
      before.draftRing = s.draftRing;
      after.draftRing = patch.draftRing ?? null;
    }
    if ('draftLots' in patch) {
      before.draftLots = s.draftLots;
      after.draftLots = patch.draftLots ?? [];
    }
    set({
      ...patch,
      dirtyManzana: s.dirtyManzana || 'draftRing' in patch,
      dirtyLots: s.dirtyLots || 'draftLots' in patch,
      undoStack: [...s.undoStack.slice(-(UNDO_LIMIT - 1)), { label, before, after }],
      redoStack: [],
    });
  },

  setTransient: (patch) => {
    set({ ...patch });
  },

  commitTransient: (label, before) => {
    const s = get();
    const after: DraftPatch = {};
    if ('draftRing' in before) after.draftRing = s.draftRing;
    if ('draftLots' in before) after.draftLots = s.draftLots;
    set({
      dirtyManzana: s.dirtyManzana || 'draftRing' in before,
      dirtyLots: s.dirtyLots || 'draftLots' in before,
      undoStack: [...s.undoStack.slice(-(UNDO_LIMIT - 1)), { label, before, after }],
      redoStack: [],
    });
  },

  undo: () => {
    const s = get();
    const cmd = s.undoStack[s.undoStack.length - 1];
    if (!cmd) return;
    set({
      ...cmd.before,
      dirtyManzana: s.dirtyManzana || 'draftRing' in cmd.before,
      dirtyLots: s.dirtyLots || 'draftLots' in cmd.before,
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, cmd],
      selectedVertex: null,
    });
  },

  redo: () => {
    const s = get();
    const cmd = s.redoStack[s.redoStack.length - 1];
    if (!cmd) return;
    set({
      ...cmd.after,
      dirtyManzana: s.dirtyManzana || 'draftRing' in cmd.after,
      dirtyLots: s.dirtyLots || 'draftLots' in cmd.after,
      undoStack: [...s.undoStack, cmd],
      redoStack: s.redoStack.slice(0, -1),
      selectedVertex: null,
    });
  },

  setTool: (t) => {
    const patch: Partial<BuilderState> = { tool: t };
    if (t !== 'draw') patch.drawPoints = [];
    if (t !== 'vertex' && t !== 'draw') patch.selectedVertex = null;
    set(patch);
  },
  setSnapEnabled: (v) => set({ snapEnabled: v }),
  selectLot: (key) => set({ selectedLotKey: key }),
  selectVertex: (v) => set({ selectedVertex: v }),
  setDrawPoints: (pts) => set({ drawPoints: pts }),
  closeDrawRing: () => {
    const pts = get().drawPoints;
    if (pts.length < 3) return;
    get().commit('Dibujar contorno', { draftRing: ensureCCW(pts.map(roundPt)) });
    set({ drawPoints: [], selectedVertex: null });
  },
  setPreview: (p) => set({ preview: p }),
  setSpecDraft: (patch) => set((s) => ({ specDraft: { ...s.specDraft, ...patch } })),
  setSideAHint: (p) => set({ sideAHint: p }),
  setPickingSideA: (v) => set({ pickingSideA: v }),

  setUnderlay: (u) => set({ underlay: u, underlayVisible: u ? true : false }),
  setUnderlayOpacity: (v) => set({ underlayOpacity: Math.min(1, Math.max(0.05, v)) }),
  setUnderlayVisible: (v) => set({ underlayVisible: v }),
}));

/** Selected manzana row (or null). */
export function selectedManzana(s: BuilderState): BuilderManzana | null {
  return s.selectedId ? s.manzanas.find((m) => m.id === s.selectedId) ?? null : null;
}
