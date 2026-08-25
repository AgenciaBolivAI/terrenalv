import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import VentasClient from '@/features/admin/ventas/VentasClient';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import { EmptyState } from '@/features/admin/ui/bits';

export const metadata: Metadata = { title: 'Ventas' };
export const dynamic = 'force-dynamic';

// Ventas confirmadas: el registro de lo vendido y su saldo.
//
// Sin filtro de rol a propósito: el equipo de ventas atiende a compradores que
// ya compraron y necesita ver saldos y recibos. Lo que sí es restringido
// (egresos, libros, estados) sigue en Contabilidad con su propia regla.
export default async function VentasPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>;
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }
  if (!ctx.project) {
    return <EmptyState title="Proyecto no encontrado" hint="Ejecuta las migraciones." />;
  }

  const { open } = await searchParams;

  return (
    <VentasClient
      projectId={ctx.project.id}
      projects={ctx.projects}
      open={open ?? null}
    />
  );
}
