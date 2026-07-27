'use client';

// 2D / 3D switch. The 3D scene ships later — the button is an honest disabled
// placeholder, but the store wiring (viewMode) is already in place.

import { useMapStore } from '../store/useMapStore';

export function ViewToggle() {
  const viewMode = useMapStore((s) => s.viewMode);
  const setViewMode = useMapStore((s) => s.setViewMode);

  return (
    <div className="pointer-events-auto absolute bottom-3 right-3 z-10 flex items-center overflow-hidden rounded-full bg-white/90 text-xs font-semibold shadow-md backdrop-blur">
      <button
        type="button"
        onClick={() => setViewMode('2d')}
        aria-pressed={viewMode === '2d'}
        className={
          viewMode === '2d'
            ? 'bg-brand px-3.5 py-2 text-white'
            : 'px-3.5 py-2 text-stone-600'
        }
      >
        2D
      </button>
      <button
        type="button"
        disabled
        title="Muy pronto"
        className="cursor-not-allowed px-3.5 py-2 text-stone-400"
      >
        3D · Próximamente
      </button>
    </div>
  );
}
