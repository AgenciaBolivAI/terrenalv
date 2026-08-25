import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import PlanesClient from '@/features/admin/planes/PlanesClient';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import { EmptyState } from '@/features/admin/ui/bits';
import { isAccounting } from '@/features/admin/lib/roles';

export const metadata: Metadata = { title: 'Planes' };
export const dynamic = 'force-dynamic';

// Planes de pago: el cronograma de cada venta financiada y lo que falta cobrar.
//
// Ventas responde "qué se vendió y cuánto debe"; esto responde "cuándo entra esa
// plata y quién dejó de pagar". Vivía enterrado en una pestaña de Contabilidad,
// donde el cronograma solo se veía cuota por cuota abriendo un diálogo por
// cliente — imposible mirar la cartera entera de un vistazo.
//
// Restringida igual que Contabilidad: un plan expone precio, financiamiento e
// interés, que es exactamente la plata de la empresa que el rol de ventas no ve.
// La RLS ya lo impide, pero una pantalla que carga vacía no explica por qué.
export default async function PlanesPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>;
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }
  if (!isAccounting(ctx.profile.role)) {
    return (
      <EmptyState
        title="Sección restringida"
        hint="Los planes de pago muestran precios, financiamiento e interés: no están disponibles para el rol de ventas."
      />
    );
  }
  if (!ctx.project) {
    return <EmptyState title="Proyecto no encontrado" hint="Ejecuta las migraciones." />;
  }

  const { open } = await searchParams;

  return (
    <PlanesClient
      projectId={ctx.project.id}
      projects={ctx.projects}
      open={open ?? null}
    />
  );
}
