import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import InventarioClient from '@/features/admin/inventario/InventarioClient';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import { EmptyState } from '@/features/admin/ui/bits';
import { isAccounting } from '@/features/admin/lib/roles';

export const metadata: Metadata = { title: 'Inventario de terrenos' };
export const dynamic = 'force-dynamic';

export default async function InventarioPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }
  if (!isAccounting(ctx.profile.role)) {
    return <EmptyState title="Sección restringida" hint="El inventario de terrenos lo maneja Contabilidad." />;
  }
  return <InventarioClient />;
}
