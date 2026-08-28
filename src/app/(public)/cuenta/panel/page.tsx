import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import PanelCliente from '@/features/cuenta/PanelCliente';
import { PublicShell } from '@/features/reservations/components/PublicShell';
import { createClient } from '@/lib/supabase/server';
import { hasSupabaseConfig } from '@/lib/supabase/config';

export const metadata: Metadata = {
  title: 'Mis lotes — Terrenalv',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

export default async function PanelClientePage() {
  if (!hasSupabaseConfig) redirect('/cuenta');
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/cuenta');

  return (
    <PublicShell maxWidth="max-w-2xl">
      <PanelCliente />
    </PublicShell>
  );
}
