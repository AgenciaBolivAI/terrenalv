'use client';

// 2D / 3D switch backed by the shared store's viewMode. MapShell passes
// `disabled3d` when the device failed the 3D quality gate (no WebGL2 / GPU
// tier 0 / lost context) — the button then stays as an honest disabled state.

import { useMapStore } from '../store/useMapStore';

export function ViewToggle({ disabled3d = false }: { disabled3d?: boolean }) {
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
        onClick={() => setViewMode('3d')}
        disabled={disabled3d}
        aria-pressed={viewMode === '3d'}
        title={disabled3d ? 'Vista 3D no disponible en este dispositivo' : 'Explorar en 3D'}
        className={
          disabled3d
            ? 'cursor-not-allowed px-3.5 py-2 text-stone-300'
            : viewMode === '3d'
              ? 'bg-brand px-3.5 py-2 text-white'
              : 'px-3.5 py-2 text-stone-600'
        }
      >
        3D
      </button>
    </div>
  );
}
