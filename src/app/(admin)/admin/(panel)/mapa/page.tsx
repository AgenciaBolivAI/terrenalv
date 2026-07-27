import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import { EmptyState } from '@/features/admin/ui/bits';
import BuilderShell from '@/features/map/builder/BuilderShell';

export const metadata: Metadata = { title: 'Editor de mapa' };
export const dynamic = 'force-dynamic';

/** Admin-only Map Builder: draw manzanas, subdivide lots, calibrate planos, publish. */
export default async function MapaPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }
  if (ctx.profile.role !== 'admin') {
    return <EmptyState title="Acceso restringido" hint="Esta sección es solo para administradores." />;
  }
  if (!ctx.project) {
    return (
      <EmptyState
        title="Sin conexión al proyecto"
        hint="Ejecuta las migraciones y el seed de la base de datos para habilitar el editor."
      />
    );
  }
  return (
    // Cancel the panel main padding and fill the viewport below the 3.5rem header.
    <div className="-mx-3 -mt-4 -mb-24 h-[calc(100dvh-3.5rem)] sm:-mx-5 md:-mb-8">
      <BuilderShell projectId={ctx.project.id} />
    </div>
  );
}
