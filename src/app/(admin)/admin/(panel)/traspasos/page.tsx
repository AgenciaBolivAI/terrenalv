import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import TraspasosClient from '@/features/admin/traspasos/TraspasosClient';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import { EmptyState } from '@/features/admin/ui/bits';

export const metadata: Metadata = { title: 'Traspasos' };
export const dynamic = 'force-dynamic';

// El registro de traspasos: quién cedió, quién recibió, cuánta plata viajó y
// qué empleado lo firmó.
//
// Sin filtro de rol a propósito: ventas atiende a las dos partes de un
// traspaso y necesita la historia tanto como contabilidad.
export default async function TraspasosPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }
  if (!ctx.project) {
    return <EmptyState title="Proyecto no encontrado" hint="Ejecuta las migraciones." />;
  }

  return <TraspasosClient />;
}
