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

/** `null` = todas las urbanizaciones juntas. */
export type ProjectScope = string | null;

export interface Period {
  /** Días hacia atrás desde hoy. `null` = toda la historia. */
  days: number | null;
  label: string;
}

export const PERIODS: Period[] = [
  { days: 30, label: '30 días' },
  { days: 90, label: '90 días' },
  { days: 180, label: '6 meses' },
  { days: 365, label: '12 meses' },
  { days: null, label: 'Todo' },
];

/** yyyy-mm-dd del inicio del período, o null si es "Todo". */
export function periodStart(days: number | null): string | null {
  if (days === null) return null;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Cómo se llama lo que se está mirando — para títulos y para el PDF/CSV. */
export function scopeLabel(scope: ProjectScope, projects: AdminProject[]): string {
  if (scope === null) {
    return projects.length === 1
      ? projects[0]?.name ?? 'Todas las urbanizaciones'
      : `Todas las urbanizaciones (${projects.length})`;
  }
  return projects.find((p) => p.id === scope)?.name ?? 'Urbanización';
}

/**
 * Moneda en la que mostrar las cifras.
 *
 * Consolidado siempre en bolivianos: es la única forma de sumar proyectos que
 * podrían llevarse en monedas distintas. Un proyecto solo se muestra en la suya.
 */
export function scopeCurrency(
  scope: ProjectScope,
  projects: AdminProject[],
): 'BOB' | 'USD' {
  if (scope === null) return 'BOB';
  return projects.find((p) => p.id === scope)?.currency ?? 'BOB';
}

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
