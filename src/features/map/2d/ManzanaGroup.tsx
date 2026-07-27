'use client';

// One <g> per manzana. LOD 0: a single aggregate-colored outline (whole-plat
// overview). LOD >= 1: outline + LotPath children, but children mount only
// while the manzana intersects the (20%-padded) viewport. All subscriptions
// resolve to primitives, so gesture-frame churn re-renders nothing.

import React from 'react';
import type { MapManzana } from '../data/types';
import { useMapStore } from '../store/useMapStore';
import { LotPath } from './LotPath';
import { intersectsPadded } from './viewbox';

/** 4-step green ramp by % of lots disponible; gray when nothing is priced. */
function aggregateFill(total: number, disponibles: number, priced: number): string {
  if (total === 0 || priced === 0) return '#e7e5e4';
  if (disponibles === 0) return '#f0efeb';
  const pct = disponibles / total;
  if (pct < 1 / 3) return '#dcfce7';
  if (pct < 2 / 3) return '#bbf7d0';
  return '#86efac';
}

function ManzanaGroupInner({ manzana }: { manzana: MapManzana }) {
  const m = manzana;
  const lodBucket = useMapStore((s) => s.lodBucket);
  const visible = useMapStore(
    (s) =>
      s.lodBucket >= 1 &&
      (s.viewportBbox === null || intersectsPadded(m.bbox, s.viewportBbox, 0.6)),
  );
  // Primitive selector (count) so a broadcast only re-renders when it changes.
  // Precomputed in the store when statuses change — these selectors used to
  // loop every lot id on EVERY store write, including each zoom-frame update.
  const disponibles = useMapStore((s) => s.manzanaStats[m.id]?.disponibles ?? 0);
  const pricedCount = useMapStore((s) => s.manzanaStats[m.id]?.priced ?? 0);
  const lots = useMapStore((s) => s.lots);

  const isResidencial = m.kind === 'residencial';
  const [x0, y0, x1, y1] = m.bbox;
  const minDim = Math.min(x1 - x0, y1 - y0);

  // ---- LOD 0: aggregate overview ----
  if (lodBucket === 0) {
    return (
      <g>
        {isResidencial ? (
          <path
            d={m.path}
            fill={aggregateFill(m.lotIds.length, disponibles, pricedCount)}
            stroke="#57534e"
            strokeWidth={0.9}
            pointerEvents="none"
          />
        ) : (
          <path d={m.path} className={`mz-outline mz-${m.kind}`} pointerEvents="none" />
        )}
        {minDim >= 28 ? (
          <text
            x={m.labelCenter[0]}
            y={m.labelCenter[1]}
            className="map-label"
            fontSize={Math.min(18, Math.max(8, minDim * 0.35))}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {m.code}
          </text>
        ) : null}
      </g>
    );
  }

  // ---- LOD >= 1: outline always (silhouette), lots only when in viewport ----
  return (
    <g>
      <path d={m.path} className={`mz-outline mz-${m.kind}`} pointerEvents="none" />
      {visible && isResidencial
        ? m.lotIds.map((id) => {
            const lot = lots.get(id);
            return lot ? <LotPath key={id} lot={lot} /> : null;
          })
        : null}
      {visible ? (
        <text
          x={(x0 + x1) / 2}
          y={y0 - 1.5}
          className="map-label"
          fontSize={5}
          opacity={0.8}
          textAnchor="middle"
        >
          {m.code}
        </text>
      ) : null}
    </g>
  );
}

export const ManzanaGroup = React.memo(ManzanaGroupInner);
