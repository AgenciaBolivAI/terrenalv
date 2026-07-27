import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import TeamClient from '@/features/admin/equipo/TeamClient';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import { EmptyState } from '@/features/admin/ui/bits';

export const metadata: Metadata = { title: 'Equipo' };
export const dynamic = 'force-dynamic';

export default async function EquipoPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }
  if (ctx.profile.role !== 'admin') {
    return <EmptyState title="Acceso restringido" hint="Esta sección es solo para administradores." />;
  }
  return <TeamClient selfId={ctx.profile.id} />;
}
