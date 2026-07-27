'use client';

// Lot numbers, only at the deepest LOD and only for viewport-visible lots.
// Recomputes on the throttled viewport updates (~8 Hz max), renders plain
// non-interactive <text> nodes.

import React from 'react';
import { useMapStore } from '../store/useMapStore';
import { intersectsPadded } from './viewbox';

export function LabelLayer() {
  const lodBucket = useMapStore((s) => s.lodBucket);
  const viewportBbox = useMapStore((s) => s.viewportBbox);
  const lots = useMapStore((s) => s.lots);

  if (lodBucket !== 2 || !viewportBbox) return null;

  const labels: React.ReactElement[] = [];
  for (const lot of lots.values()) {
    if (!intersectsPadded(lot.bbox, viewportBbox, 0.1)) continue;
    const [x0, y0, x1, y1] = lot.bbox;
    const fontSize = Math.min(8, Math.max(2.2, Math.min(x1 - x0, y1 - y0) * 0.42));
    labels.push(
      <text
        key={lot.id}
        x={(x0 + x1) / 2}
        y={(y0 + y1) / 2}
        className="map-label"
        fontSize={fontSize}
        fontWeight={500}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {lot.number}
      </text>,
    );
  }
  return <g pointerEvents="none">{labels}</g>;
}
