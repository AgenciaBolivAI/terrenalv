'use client';

// Pan/zoom camera around the SVG plat (react-zoom-pan-pinch v4).
// The transform scale IS "screen px per plan meter" because PlanSurface sizes
// the SVG 1 unit = 1 CSS px. Gesture frames never touch React state directly:
// onTransform is throttled (~120 ms) into two store writes (lodBucket,
// viewportBbox), both consumed as derived primitives downstream.

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  TransformComponent,
  TransformWrapper,
  type ReactZoomPanPinchContentRef,
} from 'react-zoom-pan-pinch';
import { getMapView, saveMapView } from '@/lib/client/session-state';
import { useMapStore } from '../store/useMapStore';
import { getViewBox, type ViewportController } from './viewbox';

const THROTTLE_MS = 120;
const MAX_SCALE = 8;

function bucketFor(scale: number): 0 | 1 | 2 {
  if (scale < 0.5) return 0;
  if (scale < 2.5) return 1;
  return 2;
}

interface PlanViewportProps {
  controllerRef?: React.RefObject<ViewportController | null>;
  children: React.ReactNode;
}

export function PlanViewport({ controllerRef, children }: PlanViewportProps) {
  const planBbox = useMapStore((s) => s.planBbox);
  const vb = getViewBox(planBbox);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const transformRef = useRef<ReactZoomPanPinchContentRef | null>(null);
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const [fit, setFit] = useState<number | null>(null);

  // Measure once for the initial fit; keep sizeRef fresh for viewport math.
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

  // ---- Throttled LOD + viewport-culling updates ----------------------------
  const lastArgsRef = useRef<{ scale: number; x: number; y: number } | null>(null);
  const lastRunRef = useRef(0);
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyTransform = useCallback(() => {
    const args = lastArgsRef.current;
    const { w, h } = sizeRef.current;
    if (!args || w <= 0 || h <= 0) return;
    const { scale, x, y } = args;
    if (!(scale > 0)) return;

    // Screen → SVG-user coords (1:1 with plan meters, y already flipped).
    const bboxNow: [number, number, number, number] = [
      (0 - x) / scale + vb.minX,
      (0 - y) / scale + vb.minY,
      (w - x) / scale + vb.minX,
      (h - y) / scale + vb.minY,
    ];

    const store = useMapStore.getState();
    const bucket = bucketFor(scale);
    if (store.lodBucket !== bucket) store.setLodBucket(bucket);
    const prev = store.viewportBbox;
    if (
      !prev ||
      Math.abs(prev[0] - bboxNow[0]) > 0.5 ||
      Math.abs(prev[1] - bboxNow[1]) > 0.5 ||
      Math.abs(prev[2] - bboxNow[2]) > 0.5 ||
      Math.abs(prev[3] - bboxNow[3]) > 0.5
    ) {
      store.setViewportBbox(bboxNow);
    }
  }, [vb.minX, vb.minY]);

  const scheduleTransform = useCallback(
    (scale: number, x: number, y: number) => {
      lastArgsRef.current = { scale, x, y };
      const now = performance.now();
      const elapsed = now - lastRunRef.current;
      if (elapsed >= THROTTLE_MS) {
        lastRunRef.current = now;
        applyTransform();
      } else if (pendingRef.current === null) {
        pendingRef.current = setTimeout(() => {
          pendingRef.current = null;
          lastRunRef.current = performance.now();
          applyTransform();
        }, THROTTLE_MS - elapsed);
      }
    },
    [applyTransform],
  );

  useEffect(
    () => () => {
      if (pendingRef.current !== null) clearTimeout(pendingRef.current);
    },
    [],
  );

  // ---- Session continuity: come back to the same spot after leaving the map
  // (e.g. to a lot's reserve page). Saved on hide/unmount, restored on init.
  // Identity of the current view: a stored transform is only meaningful for the
  // same geometry AND the same container size (rotating the phone or publishing
  // new geometry invalidates it).
  const viewKey = useCallback(() => {
    const { geometryVersion } = useMapStore.getState();
    const { w, h } = sizeRef.current;
    return `${geometryVersion}:${Math.round(w)}x${Math.round(h)}`;
  }, []);

  const persistView = useCallback(() => {
    const args = lastArgsRef.current;
    if (!args) return;
    saveMapView({
      key: viewKey(),
      scale: args.scale,
      positionX: args.x,
      positionY: args.y,
      selectedLotId: useMapStore.getState().selectedLotId,
    });
  }, [viewKey]);

  useEffect(() => {
    const onHide = () => persistView();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') persistView();
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      persistView();
    };
  }, [persistView]);

  // ---- Imperative camera for the search box --------------------------------
  useEffect(() => {
    if (!controllerRef) return;
    const zoomToBbox = (bbox: [number, number, number, number], marginFactor: number, minTarget: number, maxTarget: number) => {
      const t = transformRef.current;
      const { w, h } = sizeRef.current;
      if (!t || w <= 0 || h <= 0) return;
      const bw = Math.max(1, bbox[2] - bbox[0]);
      const bh = Math.max(1, bbox[3] - bbox[1]);
      const scale = Math.min(
        MAX_SCALE,
        Math.max(minTarget, Math.min(maxTarget, Math.min(w / (bw * marginFactor), h / (bh * marginFactor)))),
      );
      // Content CSS coords at scale 1 = svgUser − viewBox min.
      const cx = (bbox[0] + bbox[2]) / 2 - vb.minX;
      const cy = (bbox[1] + bbox[3]) / 2 - vb.minY;
      t.setTransform(w / 2 - cx * scale, h / 2 - cy * scale, scale, 350, 'easeOut');
    };
    controllerRef.current = {
      zoomToLot: (lotId) => {
        const lot = useMapStore.getState().lots.get(lotId);
        if (lot) zoomToBbox(lot.bbox, 5, 3, 7);
      },
      zoomToManzana: (manzanaId) => {
        const m = useMapStore.getState().manzanas.find((x) => x.id === manzanaId);
        if (m) zoomToBbox(m.bbox, 1.3, fit ?? 0.3, MAX_SCALE);
      },
    };
    return () => {
      controllerRef.current = null;
    };
  }, [controllerRef, vb.minX, vb.minY, fit]);

  return (
    <div ref={containerRef} className="h-full w-full touch-none overscroll-none">
      {fit !== null ? (
        <TransformWrapper
          ref={transformRef}
          initialScale={fit}
          minScale={fit * 0.85}
          maxScale={MAX_SCALE}
          centerOnInit
          centerZoomedOut
          limitToBounds
          doubleClick={{ mode: 'zoomIn', step: 0.7 }}
          wheel={{ step: 0.2 }}
          onInit={(ref) => {
            const stored = getMapView(viewKey());
            if (stored && fit !== null && stored.scale >= fit * 0.85 && stored.scale <= MAX_SCALE) {
              ref.setTransform(stored.positionX, stored.positionY, stored.scale, 0);
              scheduleTransform(stored.scale, stored.positionX, stored.positionY);
              return;
            }
            const st = ref.state;
            scheduleTransform(st.scale, st.positionX, st.positionY);
          }}
          onTransform={(_ref, state) => {
            scheduleTransform(state.scale, state.positionX, state.positionY);
          }}
        >
          <TransformComponent
            wrapperStyle={{ width: '100%', height: '100%' }}
            contentStyle={{ width: vb.width, height: vb.height }}
          >
            {children}
          </TransformComponent>
        </TransformWrapper>
      ) : null}
    </div>
  );
}
