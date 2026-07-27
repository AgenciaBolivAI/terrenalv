import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import ReservationsClient from '@/features/admin/reservas/ReservationsClient';
import { TABS, type TabId } from '@/features/admin/reservas/types';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';

export const metadata: Metadata = { title: 'Reservas' };
export const dynamic = 'force-dynamic';

export default async function ReservasPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; open?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }
  const tab = (TABS.some((t) => t.id === sp.tab) ? sp.tab : 'revisar') as TabId;

  return (
    <ReservationsClient
      projectId={ctx.project?.id ?? null}
      role={ctx.profile.role}
      initialTab={tab}
      openId={sp.open ?? null}
      initialQuery={sp.q ?? ''}
    />
  );
}
