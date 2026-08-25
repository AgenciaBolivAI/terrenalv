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
  // La bandeja de confirmadas se mudó a /admin/ventas: acá queda solo la cola
  // de trabajo. Los enlaces viejos (dashboard, analítica, marcadores) siguen
  // llegando con ?tab=confirmadas, así que se los reenvía en vez de dejarlos
  // caer en "Por revisar" como si nada.
  if (sp.tab === 'confirmadas') {
    redirect(sp.open ? `/admin/ventas?open=${encodeURIComponent(sp.open)}` : '/admin/ventas');
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
