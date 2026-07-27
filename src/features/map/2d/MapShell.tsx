'use client';

// Client composition root for the map. Receives raw server-loaded data,
// hydrates the shared map store exactly once (ref-guarded, during render so
// children mount against a ready store), and wires the realtime channel.
//
// 3D strategy: Scene3D is next/dynamic({ ssr: false }) — its chunk (three,
// drei, detect-gpu) only downloads on the FIRST switch to '3d'. The 2D plat
// stays mounted underneath (hidden with CSS) so pan/zoom state survives round
// trips; Scene3D itself unmounts when switching back to 2D (simpler, frees the
// WebGL context; it re-inits from the overview camera on re-entry).

import dynamic from 'next/dynamic';
import { useCallback, useRef, useState } from 'react';
import type { MapProjectInfo } from '../data/loadGeometry';
import { parseSnapshot } from '../data/parseSnapshot';
import type { GeometrySnapshot, LotStatusEntry, StatusSnapshot } from '../data/types';
import { useLotStatusChannel } from '../realtime/useLotStatusChannel';
import { useMapStore } from '../store/useMapStore';
import { LotBottomSheet } from './LotBottomSheet';
import { LotSearch } from './LotSearch';
import { MapLegend } from './MapLegend';
import { PlanSurface } from './PlanSurface';
import { PlanViewport } from './PlanViewport';
import { ViewToggle } from './ViewToggle';
import type { ViewportController } from './viewbox';

const Scene3D = dynamic(() => import('../3d/Scene3D').then((m) => m.Scene3D), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-stone-100 text-sm font-medium text-stone-500">
      Cargando vista 3D…
    </div>
  ),
});

interface MapShellProps {
  snapshot: GeometrySnapshot;
  statuses: StatusSnapshot | null;
  project: MapProjectInfo;
}

export function MapShell({ snapshot, statuses, project }: MapShellProps) {
  const hydratedRef = useRef(false);
  if (!hydratedRef.current) {
    hydratedRef.current = true;
    const parsed = parseSnapshot(snapshot);
    const store = useMapStore.getState();
    store.setGeometry({
      geometryVersion: parsed.version,
      planBbox: parsed.planBbox,
      maxY: parsed.maxY,
      lots: parsed.lots,
      manzanas: parsed.manzanas,
      elements: parsed.elements,
    });
    // Statuses may be null (loader gave up without inventing data): browsable,
    // nothing reservable.
    const entries: ({ id: string } & LotStatusEntry)[] =
      statuses?.lots ??
      Array.from(parsed.lots.keys(), (id) => ({
        id,
        st: 'disponible' as const,
        priced: false,
        price: null,
      }));
    store.applyStatusSnapshot(
      statuses?.status_rev ?? 0,
      statuses?.server_now ?? new Date().toISOString(),
      entries,
    );
    store.selectLot(null);
  }

  const controllerRef = useRef<ViewportController | null>(null);
  useLotStatusChannel(project.projectId);

  const viewMode = useMapStore((s) => s.viewMode);
  const [blocked3d, setBlocked3d] = useState(false);
  const handle3dUnsupported = useCallback(() => {
    setBlocked3d(true);
    useMapStore.getState().setViewMode('2d');
  }, []);

  return (
    <div className="relative h-full w-full">
      {/* 2D stays mounted while in 3D (display:none) to preserve pan state. */}
      <div className={viewMode === '3d' ? 'hidden' : 'h-full w-full'}>
        <PlanViewport controllerRef={controllerRef}>
          <PlanSurface />
        </PlanViewport>
      </div>

      {viewMode === '3d' && !blocked3d ? (
        <div className="absolute inset-0">
          <Scene3D onUnsupported={handle3dUnsupported} />
        </div>
      ) : null}

      <LotSearch controllerRef={controllerRef} />
      <MapLegend />
      <ViewToggle disabled3d={blocked3d} />

      {project.source === 'seed' ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-16 z-10 flex justify-center px-3">
          <span className="rounded-full bg-earth/90 px-3 py-1 text-center text-[11px] font-semibold text-white shadow-md">
            Vista previa del plano — reservas en línea muy pronto
          </span>
        </div>
      ) : null}

      <LotBottomSheet project={project} />
    </div>
  );
}
