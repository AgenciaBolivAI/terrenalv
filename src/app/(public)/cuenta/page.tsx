import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import CuentaAuth from '@/features/cuenta/CuentaAuth';
import { PublicShell } from '@/features/reservations/components/PublicShell';
import { createClient } from '@/lib/supabase/server';
import { hasSupabaseConfig } from '@/lib/supabase/config';

export const metadata: Metadata = {
  title: 'Mi cuenta — Terrenalv',
  description: 'Entrá a tu cuenta para ver tus lotes, tu plan de pagos y publicar en el mercado.',
};
export const dynamic = 'force-dynamic';

// La puerta del COMPRADOR. La del equipo es /admin/login y no se cruzan.
export default async function CuentaPage({
  searchParams,
}: {
  searchParams: Promise<{ crear?: string }>;
}) {
  if (hasSupabaseConfig) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) redirect('/cuenta/panel');
  }

  const { crear } = await searchParams;

  return (
    <PublicShell maxWidth="max-w-md">
      <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold text-stone-900">
          {crear ? 'Creá tu cuenta' : 'Mi cuenta'}
        </h1>
        <p className="mt-1 mb-4 text-sm text-stone-600">
          Con tu cuenta ves tus lotes y tu plan de pagos cuando quieras, sin buscar ningún código —
          y podés publicar tu lote en el mercado.
        </p>
        {hasSupabaseConfig ? (
          <CuentaAuth modo={crear ? 'crear' : 'entrar'} />
        ) : (
          <p className="text-sm text-stone-500">
            Sin conexión a la base de datos. Volvé a intentar en un momento.
          </p>
        )}
      </div>
    </PublicShell>
  );
}
