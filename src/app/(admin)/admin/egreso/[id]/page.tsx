import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import { PrintButton } from '@/features/admin/contabilidad/PrintButton';
import { ComprobanteEgreso, type EgresoDoc } from '@/features/admin/contabilidad/ComprobanteEgreso';

export const metadata: Metadata = { title: 'Comprobante de egreso' };
export const dynamic = 'force-dynamic';

// Vive fuera del shell del panel a propósito: al imprimir no debe salir la
// navegación, igual que el recibo.
export default async function EgresoPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }

  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from('v_egresos').select('*').eq('id', id).maybeSingle();
  if (!data) notFound();

  return (
    <main className="mx-auto max-w-2xl p-6 print:p-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <a
          href="/admin/contabilidad?tab=egresos"
          className="text-sm font-semibold text-brand hover:underline"
        >
          ← Volver a egresos
        </a>
        <PrintButton />
      </div>
      <ComprobanteEgreso e={data as unknown as EgresoDoc} />
    </main>
  );
}
