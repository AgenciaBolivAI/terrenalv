import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import ClientesClient from '@/features/admin/clientes/ClientesClient';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import { EmptyState } from '@/features/admin/ui/bits';

export const metadata: Metadata = { title: 'Carteras' };
export const dynamic = 'force-dynamic';

// El cliente como eje: quién es, qué lotes tiene, qué pagó, qué debe.
//
// Sin restricción de rol a propósito: ventas necesita el perfil del cliente
// tanto como contabilidad — es la ficha que se abre cuando la persona llama.
export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ ci?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }
  if (!ctx.project) {
    return <EmptyState title="Proyecto no encontrado" hint="Ejecuta las migraciones." />;
  }

  return <ClientesClient abrirCi={sp.ci ?? null} />;
}
