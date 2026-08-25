import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import { PrintButton } from '@/features/admin/contabilidad/PrintButton';
import { Recibo } from '@/features/reservations/components/Recibo';
import { cargarRecibo } from '@/features/reservations/recibo';

export const metadata: Metadata = { title: 'Recibo' };
export const dynamic = 'force-dynamic';

// Recibo de un pago, para imprimir o mandar al comprador.
//
// El papel en sí vive en <Recibo>, compartido con la página del comprador: si
// cada lado armara el suyo terminarían diciendo cosas distintas del mismo pago.
//
// Vive fuera del shell del panel a propósito: al imprimir no debe salir la
// navegación.
export default async function ReciboPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }

  const { id } = await params;
  const r = await cargarRecibo(id);
  if (!r) notFound();

  const enlaceComprador = `/reserva/${encodeURIComponent(r.tracking_code)}/recibo/${r.id}`;

  return (
    <main className="mx-auto max-w-2xl p-6 print:p-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <a
          href="/admin/contabilidad?tab=cobrar"
          className="text-sm font-semibold text-brand hover:underline"
        >
          ← Volver
        </a>
        <div className="flex items-center gap-2">
          <a
            href={enlaceComprador}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100"
            title="La misma página que ve el comprador con su código"
          >
            Ver como el comprador
          </a>
          <PrintButton />
        </div>
      </div>

      <Recibo r={r} emitidoPor={ctx.profile.full_name ?? undefined} />
    </main>
  );
}
