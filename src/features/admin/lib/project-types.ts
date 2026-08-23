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
}
