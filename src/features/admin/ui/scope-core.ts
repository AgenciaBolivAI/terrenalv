// Reglas de alcance del tablero: qué urbanización, qué período, qué moneda.
//
// Separado del componente a propósito: son funciones puras y son las que, mal
// aplicadas, hacen que un consolidado sume dólares con bolivianos sin que nada
// falle a la vista. Poder probarlas sin montar React es la diferencia entre
// que eso se detecte en una prueba o en un balance.

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

/**
 * Elegir la columna de plata correcta según el alcance.
 *
 * Consolidado lee la columna normalizada a bolivianos (`*_bob`); una sola
 * urbanización lee la original, en su moneda. Va acá y no dentro del
 * componente para poder probarlo: es la regla que, mal aplicada, suma dólares
 * con bolivianos sin que nada falle a la vista.
 */
export function pickMoney(row: object, field: string, consolidated: boolean): number {
  const r = row as Record<string, unknown>;
  const v = consolidated ? (r[`${field}_bob`] ?? r[field]) : r[field];
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

