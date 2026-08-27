import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import RrhhClient from '@/features/admin/rrhh/RrhhClient';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import { EmptyState } from '@/features/admin/ui/bits';
import { isAccounting } from '@/features/admin/lib/roles';

export const metadata: Metadata = { title: 'Recursos Humanos' };
export const dynamic = 'force-dynamic';

export default async function RrhhPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }
  if (!isAccounting(ctx.profile.role)) {
    return <EmptyState title="Sección restringida" hint="Recursos Humanos lo manejan Administración y Contabilidad." />;
  }
  return <RrhhClient />;
}
