import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import AccountingClient from '@/features/admin/contabilidad/AccountingClient';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import { EmptyState } from '@/features/admin/ui/bits';

export const metadata: Metadata = { title: 'Contabilidad' };
export const dynamic = 'force-dynamic';

const TABS = ['resumen', 'cobrar', 'egresos'] as const;
type Tab = (typeof TABS)[number];

export default async function ContabilidadPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }
  // Money out (expenses) is admin-only at the RLS level; the page follows.
  if (ctx.profile.role !== 'admin') {
    return (
      <EmptyState
        title="Solo para administradores"
        hint="La contabilidad del proyecto no está disponible para el rol de ventas."
      />
    );
  }
  if (!ctx.project) {
    return <EmptyState title="Proyecto no encontrado" hint="Ejecuta las migraciones." />;
  }

  const { tab } = await searchParams;
  const initialTab = (TABS as readonly string[]).includes(tab ?? '') ? (tab as Tab) : 'resumen';

  return (
    <AccountingClient
      projectId={ctx.project.id}
      currency={ctx.project.currency ?? 'BOB'}
      initialTab={initialTab}
    />
  );
}
