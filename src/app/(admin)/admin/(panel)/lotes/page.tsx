import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import LotesClient from '@/features/admin/lotes/LotesClient';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';

export const metadata: Metadata = { title: 'Lotes' };
export const dynamic = 'force-dynamic';

export default async function LotesPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }
  return (
    <LotesClient
      projectId={ctx.project?.id ?? null}
      role={ctx.profile.role}
      currency={ctx.project?.currency ?? 'USD'}
    />
  );
}
