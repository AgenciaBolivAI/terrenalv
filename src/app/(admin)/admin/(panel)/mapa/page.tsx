import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import { EmptyState } from '@/features/admin/ui/bits';

export const metadata: Metadata = { title: 'Mapa' };
export const dynamic = 'force-dynamic';

/** Placeholder — the Builder (editor de mapa) is a separate deliverable. */
export default async function MapaPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }
  if (ctx.profile.role !== 'admin') {
    return <EmptyState title="Acceso restringido" hint="Esta sección es solo para administradores." />;
  }
  return (
    <EmptyState
      title="Editor de mapa en preparación"
      hint="Aquí se dibujarán manzanas y lotes sobre el plano calibrado."
    />
  );
}
