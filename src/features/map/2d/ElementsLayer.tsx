'use client';

// Streets, avenues, green areas, perimeter… Fully static after load: memoized
// on the elements array reference, never re-renders on status/viewport churn.

import React from 'react';
import type { MapElement } from '../data/types';

/** Stroke styling for LineString elements (polygons use the .el-* classes). */
const LINE_STYLE: Record<string, { stroke: string; width: number; dash?: string }> = {
  calle: { stroke: '#d6d3d1', width: 8 },
  avenida: { stroke: '#a8a29e', width: 14 },
  ciclovia: { stroke: '#f9a8d4', width: 3, dash: '4 2' },
  perimetro: { stroke: '#57534e', width: 1.2, dash: '6 3' },
  area_verde: { stroke: '#bbf7d0', width: 6 },
  amenidad: { stroke: '#7dd3fc', width: 6 },
  equipamiento: { stroke: '#fbcfe8', width: 6 },
  texto: { stroke: 'none', width: 0 },
};

/** Polygon kinds without a .el-* rule in globals.css get an inline fill. */
const POLY_FALLBACK_FILL: Record<string, string> = {
  equipamiento: '#fbcfe8',
  perimetro: 'none',
  ciclovia: '#fbcfe8',
  texto: 'none',
};

const CSS_POLY_KINDS = new Set(['calle', 'avenida', 'area_verde', 'amenidad']);

function ElementsLayerInner({ elements }: { elements: MapElement[] }) {
  return (
    <g aria-hidden="true" pointerEvents="none">
      {elements.map((el) => {
        if (el.isLine) {
          const style = LINE_STYLE[el.kind] ?? { stroke: '#d6d3d1', width: 4 };
          const width =
            typeof el.props.width_m === 'number' && el.props.width_m > 0
              ? el.props.width_m
              : style.width;
          if (style.stroke === 'none') return null;
          return (
            <path
              key={el.id}
              d={el.path}
              fill="none"
              stroke={style.stroke}
              strokeWidth={width}
              strokeDasharray={style.dash}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        }
        // The vía férrea is stored as an `avenida` polygon but must not read as
        // asphalt: ballast fill + sleeper hatch + the two rails.
        if (el.props.railway === true) {
          return (
            <g key={el.id}>
              <path d={el.path} className="el-railway" />
              <path d={el.path} fill="url(#hatch-durmientes)" />
            </g>
          );
        }
        if (CSS_POLY_KINDS.has(el.kind)) {
          return <path key={el.id} d={el.path} className={`el-${el.kind}`} />;
        }
        const fill = POLY_FALLBACK_FILL[el.kind] ?? '#e7e5e4';
        const stroke = el.kind === 'perimetro' ? '#57534e' : 'none';
        return (
          <path
            key={el.id}
            d={el.path}
            fill={fill}
            stroke={stroke}
            strokeWidth={el.kind === 'perimetro' ? 1.2 : 0}
            strokeDasharray={el.kind === 'perimetro' ? '6 3' : undefined}
          />
        );
      })}
      {elements.map((el) =>
        el.name && (el.kind === 'avenida' || el.kind === 'texto') ? (
          <text
            key={`${el.id}-label`}
            x={el.labelCenter[0]}
            y={el.labelCenter[1]}
            className="map-label"
            style={{ ['--label-px' as string]: 12 }}
            opacity={0.65}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {el.name}
          </text>
        ) : null,
      )}
    </g>
  );
}

export const ElementsLayer = React.memo(ElementsLayerInner);
