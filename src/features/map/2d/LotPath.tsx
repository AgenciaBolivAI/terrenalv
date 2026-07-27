'use client';

// One <path> per lot. Subscribes ONLY to its own status entry and its own
// selection bit — a broadcast for lot X re-renders exactly one LotPath.
// Styling lives in globals.css (.lot-path .st-*) so theme changes cost zero
// re-renders.

import React, { useRef } from 'react';
import type { MapLot } from '../data/types';
import { useMapStore } from '../store/useMapStore';

const TAP_SLOP_PX = 8;

function LotPathInner({ lot }: { lot: MapLot }) {
  const entry = useMapStore((s) => s.statusByLotId[lot.id]);
  const selected = useMapStore((s) => s.selectedLotId === lot.id);
  const downRef = useRef<{ x: number; y: number } | null>(null);

  const st = entry?.st ?? 'no_disponible';
  let className = `lot-path st-${st}`;
  if (st === 'disponible' && !entry?.priced) className += ' sin-precio';
  if (selected) className += ' selected';

  return (
    <path
      d={lot.path}
      className={className}
      onPointerDown={(e) => {
        downRef.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const down = downRef.current;
        downRef.current = null;
        if (!down) return;
        const travel = Math.hypot(e.clientX - down.x, e.clientY - down.y);
        if (travel < TAP_SLOP_PX) {
          // Keep the svg-level "tap empty map = deselect" handler from firing.
          e.stopPropagation();
          useMapStore.getState().selectLot(lot.id);
        }
      }}
      aria-label={`Lote ${lot.number}`}
    />
  );
}

export const LotPath = React.memo(LotPathInner);
