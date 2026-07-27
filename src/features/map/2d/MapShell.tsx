'use client';

// Client composition root for the 2D map. Receives raw server-loaded data,
// hydrates the shared map store exactly once (ref-guarded, during render so
// children mount against a ready store), and wires the realtime channel.

import { useRef } from 'react';
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

  return (
    <div className="relative h-full w-full">
      <PlanViewport controllerRef={controllerRef}>
        <PlanSurface />
      </PlanViewport>

      <LotSearch controllerRef={controllerRef} />
      <MapLegend />
      <ViewToggle />

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
