'use client';

// Selector de alcance: qué urbanización y qué período se está mirando.
//
// Terrenalv S.R.L. es UNA empresa con varias urbanizaciones. Hasta acá cada
// pantalla miraba una sola —la del selector de la barra— así que no había forma
// de ver el total de la empresa ni de comparar un proyecto contra otro sin
// cambiar todo el panel y anotar las cifras a mano.
//
// El mismo control va en Analítica y en Contabilidad para que "Todas" signifique
// exactamente lo mismo en las dos, y para que un proyecto nuevo aparezca en
// ambas sin tocar código: la lista sale de `projects`.

import type { AdminProject } from '@/features/admin/lib/project-types';
import {
  PERIODS,
  type ProjectScope,
} from './scope-core';

export * from './scope-core';

export function ScopeBar({
  projects,
  scope,
  onScope,
  period,
  onPeriod,
  right,
}: {
  projects: AdminProject[];
  scope: ProjectScope;
  onScope: (s: ProjectScope) => void;
  /** Omitir para pantallas sin filtro de período. */
  period?: number | null;
  onPeriod?: (days: number | null) => void;
  right?: React.ReactNode;
}) {
  const multi = projects.length > 1;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2">
      <span className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
        Urbanización
      </span>
      <div className="flex flex-wrap gap-1">
        <ScopeChip active={scope === null} onClick={() => onScope(null)}>
          {multi ? `Todas (${projects.length})` : 'Todas'}
        </ScopeChip>
        {projects.map((p) => (
          <ScopeChip key={p.id} active={scope === p.id} onClick={() => onScope(p.id)}>
            {p.name}
          </ScopeChip>
        ))}
      </div>

      {onPeriod ? (
        <>
          <span className="ml-3 text-xs font-semibold tracking-wide text-stone-500 uppercase">
            Período
          </span>
          <div className="flex flex-wrap gap-1">
            {PERIODS.map((p) => (
              <ScopeChip
                key={p.label}
                active={period === p.days}
                onClick={() => onPeriod(p.days)}
              >
                {p.label}
              </ScopeChip>
            ))}
          </div>
        </>
      ) : null}

      {right ? <div className="ml-auto">{right}</div> : null}
    </div>
  );
}

function ScopeChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors
                  focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-light ${
                    active
                      ? 'bg-brand text-white'
                      : 'bg-stone-100 text-stone-600 hover:bg-stone-200 hover:text-stone-900'
                  }`}
    >
      {children}
    </button>
  );
}
