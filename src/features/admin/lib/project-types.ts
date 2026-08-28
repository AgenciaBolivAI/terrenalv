/**
 * Tipos de proyecto compartidos entre servidor y cliente.
 *
 * Viven acá y no en `get-admin-context.ts` porque ese módulo empieza con
 * `import 'server-only'`: cualquier componente 'use client' que lo tocara —
 * aunque fuera solo por un tipo — arrastra esa marca al grafo del cliente.
 */
export interface AdminProject {
  id: string;
  slug: string;
  name: string;
  currency: 'USD' | 'BOB';
  /**
   * true = «Administración»: los libros de la empresa que no son de ninguna
   * urbanización (sueldos, servicios básicos, alquileres, fondos por rendir).
   * Entra en Contabilidad y Analítica —el consolidado es la sociedad entera—
   * pero NO en Ventas, Planes, Financiamiento ni en el selector del panel:
   * no se vende nada ahí.
   */
  es_administracion: boolean;
}

/** Las urbanizaciones de verdad, sin la fila de Administración. */
export function soloUrbanizaciones(projects: AdminProject[]): AdminProject[] {
  return projects.filter((p) => !p.es_administracion);
}
