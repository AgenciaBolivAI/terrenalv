import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import ActivosClient from '@/features/admin/activos/ActivosClient';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import { EmptyState } from '@/features/admin/ui/bits';
import { isAccounting } from '@/features/admin/lib/roles';

export const metadata: Metadata = { title: 'Activos fijos' };
export const dynamic = 'force-dynamic';

export default async function ActivosPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }
  if (!isAccounting(ctx.profile.role)) {
    return <EmptyState title="Sección restringida" hint="Los activos fijos los maneja Contabilidad." />;
  }
  return <ActivosClient />;
}
