'use client';

// Fixed bottom-left legend chips + live count of reservable lots.

import { useMapStore } from '../store/useMapStore';

function Swatch({ kind }: { kind: 'disponible' | 'reservado' | 'vendido' }) {
  if (kind === 'reservado') {
    return (
      <svg width={12} height={12} className="shrink-0 rounded-[3px]" aria-hidden="true">
        <defs>
          <pattern
            id="hatch-legend"
            width={3}
            height={3}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width={3} height={3} fill="#fdba74" />
            <line x1={0} y1={0} x2={0} y2={3} stroke="#ea580c" strokeWidth={1} />
          </pattern>
        </defs>
        <rect width={12} height={12} rx={2} fill="url(#hatch-legend)" stroke="#ea580c" strokeWidth={1} />
      </svg>
    );
  }
  const fill = kind === 'disponible' ? '#86efac' : '#d6d3d1';
  const stroke = kind === 'disponible' ? '#16a34a' : '#78716c';
  return (
    <svg width={12} height={12} className="shrink-0 rounded-[3px]" aria-hidden="true">
      <rect width={12} height={12} rx={2} fill={fill} stroke={stroke} strokeWidth={1} />
    </svg>
  );
}

export function MapLegend() {
  const disponibles = useMapStore((s) => {
    let n = 0;
    for (const id in s.statusByLotId) {
      const e = s.statusByLotId[id];
      if (e.st === 'disponible' && e.priced) n++;
    }
    return n;
  });

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-col items-start gap-1.5">
      {disponibles > 0 ? (
        <span className="pointer-events-auto rounded-full bg-brand px-2.5 py-1 text-[11px] font-semibold text-white shadow-md">
          {disponibles} {disponibles === 1 ? 'lote disponible' : 'lotes disponibles'}
        </span>
      ) : null}
      <div className="pointer-events-auto flex items-center gap-2.5 rounded-full bg-white/90 px-3 py-1.5 text-[11px] font-medium text-stone-700 shadow-md backdrop-blur">
        <span className="flex items-center gap-1">
          <Swatch kind="disponible" /> Disponible
        </span>
        <span className="flex items-center gap-1">
          <Swatch kind="reservado" /> Reservado
        </span>
        <span className="flex items-center gap-1">
          <Swatch kind="vendido" /> Vendido
        </span>
      </div>
    </div>
  );
}
