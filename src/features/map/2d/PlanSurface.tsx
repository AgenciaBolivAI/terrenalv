'use client';

// The <svg> plat itself. Geometry is write-once, so this component renders
// exactly once per load; all liveness happens inside the memoized children.
// 1 SVG user unit = 1 plan meter = 1 CSS px at scale 1 (see viewbox.ts).

import { useRef } from 'react';
import { useMapStore } from '../store/useMapStore';
import { ElementsLayer } from './ElementsLayer';
import { LabelLayer } from './LabelLayer';
import { ManzanaGroup } from './ManzanaGroup';
import { getViewBox } from './viewbox';

const TAP_SLOP_PX = 8;

export function PlanSurface() {
  const planBbox = useMapStore((s) => s.planBbox);
  const elements = useMapStore((s) => s.elements);
  const manzanas = useMapStore((s) => s.manzanas);
  const downRef = useRef<{ x: number; y: number } | null>(null);

  const vb = getViewBox(planBbox);

  return (
    <svg
      width={vb.width}
      height={vb.height}
      viewBox={`${vb.minX} ${vb.minY} ${vb.width} ${vb.height}`}
      role="img"
      aria-label="Plano de lotes"
      className="select-none"
      style={{ display: 'block' }}
      onPointerDown={(e) => {
        downRef.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        // Tap on empty map (streets, blocks, background) closes the lot sheet.
        // Lot taps stopPropagation in LotPath, so they never reach here.
        const down = downRef.current;
        downRef.current = null;
        if (!down) return;
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < TAP_SLOP_PX) {
          const store = useMapStore.getState();
          if (store.selectedLotId) store.selectLot(null);
        }
      }}
    >
      <defs>
        <pattern
          id="hatch-reservado"
          width={3}
          height={3}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width={3} height={3} fill="#fdba74" />
          <line x1={0} y1={0} x2={0} y2={3} stroke="#ea580c" strokeWidth={1} />
        </pattern>
      </defs>

      <ElementsLayer elements={elements} />
      <g>
        {manzanas.map((m) => (
          <ManzanaGroup key={m.id} manzana={m} />
        ))}
      </g>
      <LabelLayer />
    </svg>
  );
}
