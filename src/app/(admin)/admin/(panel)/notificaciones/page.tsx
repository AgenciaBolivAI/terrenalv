import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import NotificationsPageClient from '@/features/admin/notificaciones/NotificationsPageClient';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';

export const metadata: Metadata = { title: 'Notificaciones' };
export const dynamic = 'force-dynamic';

export default async function NotificacionesPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }
  return <NotificationsPageClient projectId={ctx.project?.id ?? null} profileId={ctx.profile.id} />;
}
