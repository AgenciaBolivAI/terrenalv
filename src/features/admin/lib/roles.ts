import type { TeamRole } from '@/lib/db-types';

// Un solo lugar que define qué ve cada rol. Antes la navegación tenía un
// booleano `adminOnly`, que solo sabía distinguir "admin" de "todo lo demás";
// con tres roles eso ya no alcanza y hay que decir explícitamente quién entra
// a cada sección.

export const ROLE_LABEL: Record<TeamRole, string> = {
  admin: 'Administrador',
  ventas: 'Ventas',
  contabilidad: 'Contabilidad',
};

export const ROLE_HINT: Record<TeamRole, string> = {
  admin: 'Acceso completo, incluido equipo y configuración.',
  ventas: 'Reservas, lotes y mapa. No ve plata de la empresa.',
  contabilidad: 'Cobranzas, egresos, libros y recibos. No cambia precios ni equipo.',
};

export const ALL_ROLES: TeamRole[] = ['admin', 'ventas', 'contabilidad'];

/** Quién puede ver y mover la plata: cobrar cuotas, cargar egresos, emitir recibos. */
export function isAccounting(role: TeamRole): boolean {
  return role === 'admin' || role === 'contabilidad';
}
