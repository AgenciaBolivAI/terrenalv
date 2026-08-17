import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import LotesClient from '@/features/admin/lotes/LotesClient';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';

export const metadata: Metadata = { title: 'Lotes' };
export const dynamic = 'force-dynamic';

const LOT_STATUSES = ['disponible', 'reservado', 'vendido', 'no_disponible'] as const;
type LotStatusParam = (typeof LOT_STATUSES)[number];

export default async function LotesPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }
  // ?estado=<status> lands here from the dashboard inventory cards.
  const { estado } = await searchParams;
  const initialStatus = (LOT_STATUSES as readonly string[]).includes(estado ?? '')
    ? (estado as LotStatusParam)
    : null;
  return (
    <LotesClient
      projectId={ctx.project?.id ?? null}
      role={ctx.profile.role}
      currency={ctx.project?.currency ?? 'BOB'}
      initialStatus={initialStatus}
    />
  );
}
