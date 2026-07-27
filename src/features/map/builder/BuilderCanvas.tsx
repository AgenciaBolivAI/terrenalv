'use client';

// Builder drawing surface. Same SVG conventions as the public 2D plat
// (1 SVG user unit = 1 plan meter, y flipped through lib/path.ts) wrapped in
// react-zoom-pan-pinch v4 (pattern from src/features/map/2d/PlanViewport.tsx).
//
// Interaction model:
//  * 'select'  — left-drag pans; click a lot → inspector; click a dimmed
//                manzana → switch to it.
//  * edit tools — left click/drag edits; pan with middle mouse or wheel-zoom.
//  * Shift held — snapping off (draw + vertex tools).

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  TransformComponent,
  TransformWrapper,
  type ReactZoomPanPinchContentRef,
} from 'react-zoom-pan-pinch';
import { anyDialogOpen } from '@/features/admin/ui/dialog';
import {
  bbox as ringBbox,
  centroid,
  dist,
  dot,
  normalize,
  perp,
  ringArea,
  round2,
  scale as vscale,
  sub,
} from '../lib/geom';
import { compose, type Affine } from '../lib/affine';
import { flipPt, ringToPath } from '../lib/path';
import type { Pt, Ring } from '../lib/types';
import { useBuilderStore, type DraftLot } from './builderStore';
import {
  GRID_DRAW,
  GRID_VERTEX,
  SHARED_EPS,
  nearestVertex,
  snapDrawPoint,
  snapToGrid,
  VERTEX_SNAP_DIST,
  type DrawSnap,
} from './lib/snap';

const PAD = 150; // meters of drawing room around the existing plat
const EDGE_MATCH_EPS = 0.02;
const CLICK_SLOP_PX = 6;

const KIND_FILL: Record<string, string> = {
  residencial: '#fafaf9',
  area_verde: '#ecfdf5',
  equipamiento: '#fdf2f8',
  amenidad: '#f0f9ff',
};

const STATUS_FILL: Record<string, string> = {
  disponible: '#dcfce7',
  reservado: '#fed7aa',
  vendido: '#e7e5e4',
  no_disponible: '#f1f5f9',
};

interface Vb {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

function builderViewBox(planBbox: [number, number, number, number]): Vb {
  const w = planBbox[2] - planBbox[0];
  const h = planBbox[3] - planBbox[1];
  return { minX: planBbox[0] - PAD, minY: -PAD, width: w + 2 * PAD, height: h + 2 * PAD };
}

interface SharedEdge {
  aIdx: number;
  bIdx: number;
  p: Pt;
  q: Pt;
  mid: Pt;
  axis: Pt; // unit vector perpendicular to the edge = the row axis
}

type DragState =
  | { kind: 'ring-vertex'; index: number; startRing: Ring }
  | {
      kind: 'lot-vertex';
      targets: { lotIdx: number; vtx: number }[];
      startLots: DraftLot[];
    }
  | {
      kind: 'cutline';
      edge: SharedEdge;
      startPlan: Pt;
      startLots: DraftLot[];
      f0A: number | null;
      f0B: number | null;
      sideA: number;
    };

export function BuilderCanvas({
  onSelectManzanaRequest,
}: {
  onSelectManzanaRequest: (id: string) => void;
}) {
  const manzanas = useBuilderStore((s) => s.manzanas);
  const selectedId = useBuilderStore((s) => s.selectedId);
  const draftRing = useBuilderStore((s) => s.draftRing);
  const draftLots = useBuilderStore((s) => s.draftLots);
  const tool = useBuilderStore((s) => s.tool);
  const drawPoints = useBuilderStore((s) => s.drawPoints);
  const preview = useBuilderStore((s) => s.preview);
  const selectedLotKey = useBuilderStore((s) => s.selectedLotKey);
  const selectedVertex = useBuilderStore((s) => s.selectedVertex);
  const pickingSideA = useBuilderStore((s) => s.pickingSideA);
  const sideAHint = useBuilderStore((s) => s.sideAHint);
  const planBbox = useBuilderStore((s) => s.planBbox);
  const maxY = useBuilderStore((s) => s.maxY);
  const underlay = useBuilderStore((s) => s.underlay);
  const underlayOpacity = useBuilderStore((s) => s.underlayOpacity);
  const underlayVisible = useBuilderStore((s) => s.underlayVisible);

  const vb = useMemo(() => builderViewBox(planBbox), [planBbox]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const transformRef = useRef<ReactZoomPanPinchContentRef | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const [fit, setFit] = useState<number | null>(null);
  const [pxPerM, setPxPerM] = useState(1);
  const pxPerMRef = useRef(1);
  const scaleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [hover, setHover] = useState<DrawSnap | null>(null);
  const [cutInfo, setCutInfo] = useState<{ mid: Pt; text: string } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const downRef = useRef<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 10 && r.height > 10) {
        sizeRef.current = { w: r.width, h: r.height };
        setFit((prev) => prev ?? Math.min(r.width / vb.width, r.height / vb.height));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [vb.width, vb.height]);

  const onTransform = useCallback((scale: number) => {
    pxPerMRef.current = scale;
    if (scaleTimer.current === null) {
      scaleTimer.current = setTimeout(() => {
        scaleTimer.current = null;
        setPxPerM(pxPerMRef.current);
      }, 100);
    }
  }, []);
  useEffect(
    () => () => {
      if (scaleTimer.current !== null) clearTimeout(scaleTimer.current);
    },
    [],
  );

  // Zoom the camera to a manzana when it becomes selected.
  useEffect(() => {
    if (!selectedId) return;
    const mz = useBuilderStore.getState().manzanas.find((m) => m.id === selectedId);
    const ring = mz?.ring;
    const t = transformRef.current;
    const { w, h } = sizeRef.current;
    if (!ring || ring.length < 3 || !t || w <= 0 || h <= 0) return;
    const b = ringBbox(ring.map((p) => flipPt(p, useBuilderStore.getState().maxY)));
    const bw = Math.max(5, b[2] - b[0]);
    const bh = Math.max(5, b[3] - b[1]);
    const target = Math.min(12, Math.max(0.2, Math.min(w / (bw * 1.5), h / (bh * 1.5))));
    const cx = (b[0] + b[2]) / 2 - vb.minX;
    const cy = (b[1] + b[3]) / 2 - vb.minY;
    t.setTransform(w / 2 - cx * target, h / 2 - cy * target, target, 300, 'easeOut');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // ---- coordinate mapping -------------------------------------------------
  const clientToPlan = useCallback(
    (clientX: number, clientY: number): Pt => {
      const svg = svgRef.current;
      if (!svg) return [0, 0];
      const r = svg.getBoundingClientRect();
      const sx = vb.minX + ((clientX - r.left) / r.width) * vb.width;
      const sy = vb.minY + ((clientY - r.top) / r.height) * vb.height;
      return [sx, maxY - sy];
    },
    [vb, maxY],
  );

  // ---- snap pools ---------------------------------------------------------
  const manzanaVertexPool = useMemo(() => {
    const pts: Pt[] = [];
    for (const m of manzanas) if (m.ring) pts.push(...m.ring);
    return pts;
  }, [manzanas]);

  const otherManzanaVertexPool = useMemo(() => {
    const pts: Pt[] = [];
    for (const m of manzanas) if (m.ring && m.id !== selectedId) pts.push(...m.ring);
    return pts;
  }, [manzanas, selectedId]);

  // ---- shared edges for the cutline tool ----------------------------------
  const sharedEdges = useMemo((): SharedEdge[] => {
    if (tool !== 'cutline') return [];
    const out: SharedEdge[] = [];
    for (let i = 0; i < draftLots.length; i++) {
      for (let j = i + 1; j < draftLots.length; j++) {
        const A = draftLots[i].ring;
        const B = draftLots[j].ring;
        let found = false;
        for (let ei = 0; ei < A.length && !found; ei++) {
          const p = A[ei];
          const q = A[(ei + 1) % A.length];
          if (dist(p, q) < 1) continue;
          for (let ej = 0; ej < B.length && !found; ej++) {
            const r = B[ej];
            const s2 = B[(ej + 1) % B.length];
            const match =
              (dist(p, s2) < EDGE_MATCH_EPS && dist(q, r) < EDGE_MATCH_EPS) ||
              (dist(p, r) < EDGE_MATCH_EPS && dist(q, s2) < EDGE_MATCH_EPS);
            if (match) {
              found = true;
              out.push({
                aIdx: i,
                bIdx: j,
                p,
                q,
                mid: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2],
                axis: normalize(perp(sub(q, p))),
              });
            }
          }
        }
      }
    }
    return out;
  }, [draftLots, tool]);

  // ---- draw tool ----------------------------------------------------------
  const closeRing = useCallback(() => {
    useBuilderStore.getState().closeDrawRing();
    setHover(null);
  }, []);
  const closeRingRef = useRef(closeRing);
  closeRingRef.current = closeRing;

  // ---- keyboard -----------------------------------------------------------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (anyDialogOpen()) return;
      const st = useBuilderStore.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        st.redo();
        return;
      }
      if (e.key === 'Shift') st.setSnapEnabled(false);
      if (st.tool === 'draw') {
        if (e.key === 'Enter') {
          e.preventDefault();
          closeRingRef.current();
        } else if (e.key === 'Backspace') {
          e.preventDefault();
          if (st.drawPoints.length) st.setDrawPoints(st.drawPoints.slice(0, -1));
        } else if (e.key === 'Escape') {
          st.setDrawPoints([]);
          st.selectVertex(null);
        }
      } else if (e.key === 'Escape') {
        if (st.pickingSideA) st.setPickingSideA(false);
        else {
          st.selectLot(null);
          st.selectVertex(null);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') useBuilderStore.getState().setSnapEnabled(true);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // ---- drag machinery -----------------------------------------------------
  const beginDrag = useCallback(
    (e: React.PointerEvent, state: DragState) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = state;

      const onMove = (ev: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        const st = useBuilderStore.getState();
        const plan = clientToPlan(ev.clientX, ev.clientY);

        if (drag.kind === 'ring-vertex') {
          let target: Pt;
          if (!st.snapEnabled) {
            target = [round2(plan[0]), round2(plan[1])];
          } else {
            target =
              nearestVertex(plan, otherManzanaVertexPool, VERTEX_SNAP_DIST) ??
              snapToGrid(plan, GRID_DRAW);
          }
          const ring = drag.startRing.map((p) => [p[0], p[1]] as Pt);
          ring[drag.index] = target;
          st.setTransient({ draftRing: ring });
        } else if (drag.kind === 'lot-vertex') {
          const target = st.snapEnabled
            ? snapToGrid(plan, GRID_VERTEX)
            : ([round2(plan[0]), round2(plan[1])] as Pt);
          const byLot = new Map<number, number[]>();
          for (const t of drag.targets) {
            const list = byLot.get(t.lotIdx) ?? [];
            list.push(t.vtx);
            byLot.set(t.lotIdx, list);
          }
          const lots = drag.startLots.map((lot, idx) => {
            const vts = byLot.get(idx);
            if (!vts) return lot;
            const ring = lot.ring.map((p) => [p[0], p[1]] as Pt);
            for (const v of vts) ring[v] = [target[0], target[1]];
            return { ...lot, ring };
          });
          st.setTransient({ draftLots: lots });
        } else {
          // cutline
          const { edge, startPlan, startLots, f0A, f0B, sideA } = drag;
          let delta = dot(sub(plan, startPlan), edge.axis);
          delta = Math.round(delta / GRID_VERTEX) * GRID_VERTEX;
          if (f0A != null && f0B != null) {
            // keep both frontages ≥ 0.5 m
            const maxTowardA = f0A - 0.5;
            const maxTowardB = f0B - 0.5;
            if (sideA > 0) delta = Math.min(maxTowardA, Math.max(-maxTowardB, delta));
            else delta = Math.min(maxTowardB, Math.max(-maxTowardA, delta));
          }
          const dvec = vscale(edge.axis, delta);
          // Slightly wider than EDGE_MATCH_EPS so both lots' seam vertices move.
          const CUT_MATCH = 0.03;
          const moveRing = (ring: Ring): Ring =>
            ring.map((p) =>
              dist(p, edge.p) < CUT_MATCH || dist(p, edge.q) < CUT_MATCH
                ? ([round2(p[0] + dvec[0]), round2(p[1] + dvec[1])] as Pt)
                : p,
            );
          const lots = startLots.map((lot, idx) => {
            if (idx !== edge.aIdx && idx !== edge.bIdx) return lot;
            const next: DraftLot = { ...lot, ring: moveRing(lot.ring) };
            if (f0A != null && f0B != null) {
              if (idx === edge.aIdx) next.frontage_m = round2(f0A - delta * sideA);
              else next.frontage_m = round2(f0B + delta * sideA);
            }
            return next;
          });
          st.setTransient({ draftLots: lots });
          const a = lots[edge.aIdx];
          const b = lots[edge.bIdx];
          setCutInfo({
            mid: [edge.mid[0] + dvec[0], edge.mid[1] + dvec[1]],
            text:
              f0A != null && f0B != null
                ? `${a.number}: ${a.frontage_m} m · ${b.number}: ${b.frontage_m} m`
                : `Δ ${delta.toFixed(2)} m`,
          });
        }
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        const drag = dragRef.current;
        dragRef.current = null;
        setCutInfo(null);
        if (!drag) return;
        const st = useBuilderStore.getState();
        if (drag.kind === 'ring-vertex') {
          const changed =
            st.draftRing &&
            drag.startRing.some(
              (p, i) => dist(p, (st.draftRing as Ring)[i] ?? p) > 1e-9,
            );
          if (changed) {
            st.commitTransient('Mover vértice del contorno', { draftRing: drag.startRing });
          }
        } else if (drag.kind === 'lot-vertex') {
          const affected = new Set(drag.targets.map((t) => t.lotIdx));
          const changed = st.draftLots.some(
            (l, i) =>
              affected.has(i) &&
              l.ring.some((p, vi) => dist(p, drag.startLots[i].ring[vi] ?? p) > 1e-9),
          );
          if (changed) {
            const withFlags = st.draftLots.map((l, i) =>
              affected.has(i)
                ? { ...l, is_manual_geom: true, edge_dims: null }
                : l,
            );
            st.setTransient({ draftLots: withFlags });
            st.commitTransient('Mover vértice de lote', { draftLots: drag.startLots });
          }
        } else {
          const changed = st.draftLots.some(
            (l, i) => l.ring.some((p, vi) => dist(p, drag.startLots[i].ring[vi] ?? p) > 1e-9),
          );
          if (changed) {
            const withFlags = st.draftLots.map((l, i) =>
              i === drag.edge.aIdx || i === drag.edge.bIdx
                ? { ...l, is_manual_geom: true, edge_dims: null }
                : l,
            );
            st.setTransient({ draftLots: withFlags });
            st.commitTransient('Ajustar frentes (línea de corte)', {
              draftLots: drag.startLots,
            });
          }
        }
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [clientToPlan, otherManzanaVertexPool],
  );

  // ---- svg-level pointer events -------------------------------------------
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragRef.current) return;
      if (tool !== 'draw' || pickingSideA) {
        if (hover) setHover(null);
        return;
      }
      const st = useBuilderStore.getState();
      const plan = clientToPlan(e.clientX, e.clientY);
      const pts = st.drawPoints;
      const pool = pts.length >= 3 ? [...manzanaVertexPool, pts[0]] : manzanaVertexPool;
      const snap = snapDrawPoint(
        plan,
        pts.length ? pts[pts.length - 1] : null,
        pts.length >= 2 ? pts[pts.length - 2] : null,
        pool,
        !st.snapEnabled,
      );
      setHover(snap);
    },
    [tool, pickingSideA, clientToPlan, manzanaVertexPool, hover],
  );

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    downRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const down = downRef.current;
      downRef.current = null;
      if (!down || e.button !== 0) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP_PX) return;
      const st = useBuilderStore.getState();
      const plan = clientToPlan(e.clientX, e.clientY);

      if (st.pickingSideA) {
        st.setSideAHint(plan);
        st.setPickingSideA(false);
        return;
      }

      if (st.tool === 'draw') {
        const pts = st.drawPoints;
        const pool = pts.length >= 3 ? [...manzanaVertexPool, pts[0]] : manzanaVertexPool;
        const snap = snapDrawPoint(
          plan,
          pts.length ? pts[pts.length - 1] : null,
          pts.length >= 2 ? pts[pts.length - 2] : null,
          pool,
          !st.snapEnabled,
        );
        const closeThreshold = Math.max(0.5, 10 / pxPerMRef.current);
        if (pts.length >= 3 && dist(snap.point, pts[0]) < closeThreshold) {
          closeRingRef.current();
          return;
        }
        if (!pts.length || dist(snap.point, pts[pts.length - 1]) > 0.01) {
          st.setDrawPoints([...pts, snap.point]);
        }
        return;
      }

      if (st.tool === 'select' || st.tool === 'vertex') {
        st.selectLot(null);
        st.selectVertex(null);
      }
    },
    [clientToPlan, manzanaVertexPool],
  );

  const handleDoubleClick = useCallback(() => {
    if (tool === 'draw') closeRingRef.current();
  }, [tool]);

  // ---- layers -------------------------------------------------------------
  const contextLayer = useMemo(
    () => (
      <g>
        {manzanas.map((m) => {
          if (!m.ring || m.ring.length < 3 || m.id === selectedId) return null;
          const c = flipPt(centroid(m.ring), maxY);
          return (
            <g
              key={m.id}
              style={{ pointerEvents: tool === 'select' ? 'auto' : 'none' }}
              className={tool === 'select' ? 'cursor-pointer' : undefined}
              onClick={() => onSelectManzanaRequest(m.id)}
            >
              <path
                d={ringToPath(m.ring, maxY)}
                fill={KIND_FILL[m.kind] ?? '#fafaf9'}
                stroke={m.state === 'draft' ? '#f59e0b' : '#d6d3d1'}
                strokeDasharray={m.state === 'draft' ? '2 1.2' : undefined}
                strokeWidth={0.4}
              />
              <text
                x={c[0]}
                y={c[1]}
                fontSize={6}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#a8a29e"
                fontWeight={700}
                style={{ pointerEvents: 'none' }}
              >
                {m.code}
              </text>
            </g>
          );
        })}
      </g>
    ),
    [manzanas, selectedId, maxY, tool, onSelectManzanaRequest],
  );

  const lotsLayer = useMemo(
    () => (
      <g>
        {draftLots.map((lot) => {
          const selected = lot.key === selectedLotKey;
          const stroke = selected
            ? '#2563eb'
            : lot.is_manual_geom
              ? '#8b5cf6'
              : lot.needs_review
                ? '#d97706'
                : '#57534e';
          const c = flipPt(centroid(lot.ring), maxY);
          const b = ringBbox(lot.ring);
          const wLot = b[2] - b[0];
          const hLot = b[3] - b[1];
          const fs = Math.max(0.8, Math.min(2.4, Math.min(wLot, hLot) / 3.2));
          const clickable = tool === 'select' || tool === 'vertex';
          return (
            <g key={lot.key}>
              <path
                d={ringToPath(lot.ring, maxY)}
                fill={STATUS_FILL[lot.status] ?? '#f5f5f4'}
                fillOpacity={0.85}
                stroke={stroke}
                strokeWidth={selected ? 0.35 : 0.14}
                style={{
                  pointerEvents: clickable ? 'auto' : 'none',
                  cursor: clickable ? 'pointer' : undefined,
                }}
                onPointerDown={(e) => {
                  if (e.button === 0) e.stopPropagation();
                }}
                onPointerUp={(e) => {
                  if (e.button !== 0) return;
                  e.stopPropagation();
                  useBuilderStore.getState().selectLot(lot.key);
                }}
              />
              <text
                x={c[0]}
                y={c[1]}
                fontSize={fs}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#44403c"
                fontWeight={700}
                style={{ pointerEvents: 'none' }}
              >
                {lot.number}
              </text>
              {hLot > 8 ? (
                <text
                  x={c[0]}
                  y={c[1] + fs * 1.1}
                  fontSize={fs * 0.55}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#78716c"
                  style={{ pointerEvents: 'none' }}
                >
                  {round2(ringArea(lot.ring))} m²
                </text>
              ) : null}
            </g>
          );
        })}
      </g>
    ),
    [draftLots, selectedLotKey, maxY, tool],
  );

  const previewLayer = useMemo(() => {
    if (!preview) return null;
    return (
      <g style={{ pointerEvents: 'none' }}>
        {preview.lots.map((l, i) => {
          const c = flipPt(centroid(l.ring), maxY);
          return (
            <g key={`pv-${i}`}>
              <path
                d={ringToPath(l.ring, maxY)}
                fill="#6366f1"
                fillOpacity={0.22}
                stroke="#4f46e5"
                strokeWidth={0.18}
                strokeDasharray="1 0.6"
              />
              <text
                x={c[0]}
                y={c[1]}
                fontSize={1.6}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#3730a3"
                fontWeight={700}
              >
                {l.number}
              </text>
              <text
                x={c[0]}
                y={c[1] + 1.9}
                fontSize={1}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#4338ca"
              >
                {l.area_m2} m²
              </text>
            </g>
          );
        })}
      </g>
    );
  }, [preview, maxY]);

  // Ring outline + editable vertices (draw tool).
  const ringLayer = useMemo(() => {
    if (!draftRing || draftRing.length < 3) return null;
    const hr = 5 / pxPerM;
    return (
      <g>
        <path
          d={ringToPath(draftRing, maxY)}
          fill="none"
          stroke="#16a34a"
          strokeWidth={0.5}
          style={{ pointerEvents: 'none' }}
        />
        {tool === 'draw' && drawPoints.length === 0
          ? draftRing.map((p, i) => {
              const sp = flipPt(p, maxY);
              const isSel = selectedVertex?.lotKey === null && selectedVertex.index === i;
              return (
                <circle
                  key={`rv-${i}`}
                  cx={sp[0]}
                  cy={sp[1]}
                  r={isSel ? hr * 1.4 : hr}
                  fill={isSel ? '#16a34a' : '#ffffff'}
                  stroke="#16a34a"
                  strokeWidth={hr / 3}
                  style={{ cursor: 'grab' }}
                  onPointerDown={(e) => {
                    useBuilderStore.getState().selectVertex({ lotKey: null, index: i });
                    beginDrag(e, { kind: 'ring-vertex', index: i, startRing: draftRing });
                  }}
                />
              );
            })
          : null}
      </g>
    );
  }, [draftRing, maxY, tool, drawPoints.length, selectedVertex, pxPerM, beginDrag]);

  // Lot vertex handles (vertex tool).
  const vertexHandles = useMemo(() => {
    if (tool !== 'vertex' || !draftLots.length) return null;
    const hr = 4 / pxPerM;
    // Group vertices sharing a corner (within SHARED_EPS).
    const groups = new Map<string, { pos: Pt; targets: { lotIdx: number; vtx: number }[] }>();
    draftLots.forEach((lot, lotIdx) => {
      lot.ring.forEach((p, vtx) => {
        const key = `${Math.round(p[0] / SHARED_EPS)}:${Math.round(p[1] / SHARED_EPS)}`;
        const g = groups.get(key) ?? { pos: p, targets: [] };
        g.targets.push({ lotIdx, vtx });
        groups.set(key, g);
      });
    });
    return (
      <g>
        {[...groups.entries()].map(([key, g]) => {
          const sp = flipPt(g.pos, maxY);
          const shared = g.targets.length > 1;
          return (
            <circle
              key={key}
              cx={sp[0]}
              cy={sp[1]}
              r={hr}
              fill={shared ? '#8b5cf6' : '#ffffff'}
              fillOpacity={shared ? 0.9 : 1}
              stroke="#6d28d9"
              strokeWidth={hr / 3.5}
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => {
                // Recompute co-located vertices by distance at drag start so a
                // shared corner never tears at a bucket boundary.
                const lots = useBuilderStore.getState().draftLots;
                const targets: { lotIdx: number; vtx: number }[] = [];
                lots.forEach((lot, lotIdx) => {
                  lot.ring.forEach((p, vtx) => {
                    if (dist(p, g.pos) <= SHARED_EPS) targets.push({ lotIdx, vtx });
                  });
                });
                beginDrag(e, {
                  kind: 'lot-vertex',
                  targets: targets.length ? targets : g.targets,
                  startLots: lots,
                });
              }}
            />
          );
        })}
      </g>
    );
  }, [tool, draftLots, maxY, pxPerM, beginDrag]);

  // Cutline handles.
  const cutlineHandles = useMemo(() => {
    if (tool !== 'cutline') return null;
    const hr = 6 / pxPerM;
    return (
      <g>
        {sharedEdges.map((edge, i) => {
          const sp = flipPt(edge.p, maxY);
          const sq = flipPt(edge.q, maxY);
          const sm = flipPt(edge.mid, maxY);
          return (
            <g key={`ce-${i}`}>
              <line
                x1={sp[0]}
                y1={sp[1]}
                x2={sq[0]}
                y2={sq[1]}
                stroke="#0ea5e9"
                strokeWidth={0.3}
                strokeDasharray="0.8 0.5"
                style={{ pointerEvents: 'none' }}
              />
              <circle
                cx={sm[0]}
                cy={sm[1]}
                r={hr}
                fill="#0ea5e9"
                fillOpacity={0.85}
                stroke="#0369a1"
                strokeWidth={hr / 4}
                style={{ cursor: 'ew-resize' }}
                onPointerDown={(e) => {
                  const lots = useBuilderStore.getState().draftLots;
                  const a = lots[edge.aIdx];
                  const b = lots[edge.bIdx];
                  const sideA =
                    Math.sign(dot(sub(centroid(a.ring), edge.mid), edge.axis)) || 1;
                  beginDrag(e, {
                    kind: 'cutline',
                    edge,
                    startPlan: clientToPlan(e.clientX, e.clientY),
                    startLots: lots,
                    f0A: a.frontage_m,
                    f0B: b.frontage_m,
                    sideA,
                  });
                }}
              />
            </g>
          );
        })}
      </g>
    );
  }, [tool, sharedEdges, maxY, pxPerM, beginDrag, clientToPlan]);

  // Draw-in-progress overlay.
  const drawOverlay = useMemo(() => {
    if (tool !== 'draw' || (!drawPoints.length && !hover)) return null;
    const hr = 4.5 / pxPerM;
    const flipped = drawPoints.map((p) => flipPt(p, maxY));
    let dPath = '';
    flipped.forEach((p, i) => {
      dPath += `${i ? 'L' : 'M'}${p[0]} ${p[1]}`;
    });
    const last = drawPoints[drawPoints.length - 1];
    const hoverFlip = hover ? flipPt(hover.point, maxY) : null;
    const segLen = hover && last ? round2(dist(hover.point, last)) : null;
    const closeThreshold = Math.max(0.5, 10 / pxPerM);
    const nearStart =
      hover && drawPoints.length >= 3 && dist(hover.point, drawPoints[0]) < closeThreshold;
    return (
      <g style={{ pointerEvents: 'none' }}>
        {dPath ? (
          <path d={dPath} fill="none" stroke="#2563eb" strokeWidth={0.3} strokeDasharray="1.2 0.7" />
        ) : null}
        {last && hoverFlip ? (
          <line
            x1={flipped[flipped.length - 1][0]}
            y1={flipped[flipped.length - 1][1]}
            x2={hoverFlip[0]}
            y2={hoverFlip[1]}
            stroke="#93c5fd"
            strokeWidth={0.25}
            strokeDasharray="0.8 0.6"
          />
        ) : null}
        {segLen != null && hoverFlip && last ? (
          <text
            x={(flipped[flipped.length - 1][0] + hoverFlip[0]) / 2}
            y={(flipped[flipped.length - 1][1] + hoverFlip[1]) / 2 - 1}
            fontSize={Math.max(1.2, 12 / pxPerM)}
            textAnchor="middle"
            fill="#1d4ed8"
            fontWeight={600}
          >
            {segLen} m
          </text>
        ) : null}
        {flipped.map((p, i) => (
          <circle
            key={`dp-${i}`}
            cx={p[0]}
            cy={p[1]}
            r={i === 0 && nearStart ? hr * 1.6 : hr}
            fill={i === 0 ? '#1d4ed8' : '#ffffff'}
            stroke="#1d4ed8"
            strokeWidth={hr / 3}
          />
        ))}
        {hoverFlip && hover ? (
          hover.kind === 'vertex' ? (
            <rect
              x={hoverFlip[0] - hr}
              y={hoverFlip[1] - hr}
              width={hr * 2}
              height={hr * 2}
              fill="none"
              stroke="#ea580c"
              strokeWidth={hr / 3}
            />
          ) : (
            <circle
              cx={hoverFlip[0]}
              cy={hoverFlip[1]}
              r={hr * 0.8}
              fill="none"
              stroke={hover.kind === 'angle' ? '#2563eb' : '#94a3b8'}
              strokeWidth={hr / 3}
            />
          )
        ) : null}
      </g>
    );
  }, [tool, drawPoints, hover, maxY, pxPerM]);

  const sideAMarker = useMemo(() => {
    if (!sideAHint || (tool !== 'subdivide' && !pickingSideA)) return null;
    const sp = flipPt(sideAHint, maxY);
    const r = 7 / pxPerM;
    return (
      <g style={{ pointerEvents: 'none' }}>
        <circle cx={sp[0]} cy={sp[1]} r={r} fill="#f59e0b" fillOpacity={0.5} stroke="#b45309" strokeWidth={r / 5} />
        <text x={sp[0]} y={sp[1] - r * 1.4} fontSize={Math.max(1.4, 12 / pxPerM)} textAnchor="middle" fill="#92400e" fontWeight={700}>
          Frente A
        </text>
      </g>
    );
  }, [sideAHint, tool, pickingSideA, maxY, pxPerM]);

  const underlayImage = useMemo(() => {
    if (!underlay || !underlayVisible) return null;
    const flip: Affine = { a: 1, b: 0, c: 0, d: 0, e: -1, f: maxY };
    const m = compose(flip, underlay.affine);
    return (
      <image
        href={underlay.url}
        width={underlay.widthPx}
        height={underlay.heightPx}
        opacity={underlayOpacity}
        transform={`matrix(${m.a} ${m.d} ${m.b} ${m.e} ${m.c} ${m.f})`}
        preserveAspectRatio="none"
        style={{ pointerEvents: 'none' }}
      />
    );
  }, [underlay, underlayVisible, underlayOpacity, maxY]);

  const cursor =
    pickingSideA || tool === 'draw' ? 'crosshair' : tool === 'select' ? 'grab' : 'default';

  return (
    <div ref={containerRef} className="h-full w-full touch-none overscroll-none bg-stone-100">
      {fit !== null ? (
        <TransformWrapper
          ref={transformRef}
          initialScale={fit}
          minScale={fit * 0.3}
          maxScale={40}
          centerOnInit
          limitToBounds={false}
          doubleClick={{ disabled: true }}
          wheel={{ step: 0.25 }}
          panning={{
            allowLeftClickPan: tool === 'select' && !pickingSideA,
            allowMiddleClickPan: true,
            allowRightClickPan: false,
            velocityDisabled: true,
          }}
          onInit={(ref) => onTransform(ref.state.scale)}
          onTransform={(_ref, state) => onTransform(state.scale)}
        >
          <TransformComponent
            wrapperStyle={{ width: '100%', height: '100%' }}
            contentStyle={{ width: vb.width, height: vb.height }}
          >
            <svg
              ref={svgRef}
              width={vb.width}
              height={vb.height}
              viewBox={`${vb.minX} ${vb.minY} ${vb.width} ${vb.height}`}
              role="img"
              aria-label="Editor del plano"
              className="select-none"
              style={{ display: 'block', overflow: 'visible', cursor }}
              onPointerMove={handlePointerMove}
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              onDoubleClick={handleDoubleClick}
            >
              <rect
                x={vb.minX}
                y={vb.minY}
                width={vb.width}
                height={vb.height}
                fill="#f8fafc"
              />
              {underlayImage}
              {contextLayer}
              {ringLayer}
              {lotsLayer}
              {previewLayer}
              {vertexHandles}
              {cutlineHandles}
              {drawOverlay}
              {sideAMarker}
              {cutInfo ? (
                <text
                  x={flipPt(cutInfo.mid, maxY)[0]}
                  y={flipPt(cutInfo.mid, maxY)[1] - 8 / pxPerM}
                  fontSize={Math.max(1.3, 13 / pxPerM)}
                  textAnchor="middle"
                  fill="#0c4a6e"
                  fontWeight={700}
                  style={{ pointerEvents: 'none' }}
                >
                  {cutInfo.text}
                </text>
              ) : null}
            </svg>
          </TransformComponent>
        </TransformWrapper>
      ) : null}
    </div>
  );
}
