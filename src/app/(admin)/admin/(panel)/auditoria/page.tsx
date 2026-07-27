import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import AuditClient from '@/features/admin/auditoria/AuditClient';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import { EmptyState } from '@/features/admin/ui/bits';

export const metadata: Metadata = { title: 'Auditoría' };
export const dynamic = 'force-dynamic';

export default async function AuditoriaPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }
  if (ctx.profile.role !== 'admin') {
    return <EmptyState title="Acceso restringido" hint="Esta sección es solo para administradores." />;
  }
  return <AuditClient projectId={ctx.project?.id ?? null} />;
}
