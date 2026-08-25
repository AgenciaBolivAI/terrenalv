import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import { PrintButton } from '@/features/admin/contabilidad/PrintButton';
import { Contrato } from '@/features/contracts/ContratoDoc';
import { cargarContrato } from '@/features/contracts/contrato';

export const metadata: Metadata = { title: 'Contrato' };
export const dynamic = 'force-dynamic';

// El contrato de una venta, para imprimir o mandar al comprador.
//
// Se arma SIEMPRE desde la base: traspasada la venta, el contrato del nuevo
// comprador nace solo con toda la cadena, y el del anterior sale ANULADO.
// Fuera del shell del panel a propósito: al imprimir no debe salir el menú.
export default async function ContratoPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }

  const { id } = await params;
  const c = await cargarContrato({ reservationId: id });
  if (!c) notFound();

  const enlaceComprador = `/reserva/${encodeURIComponent(c.tracking_code)}/contrato`;

  return (
    <main className="mx-auto max-w-3xl p-6 print:p-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <a
          href={`/admin/ventas?open=${c.reservation_id}`}
          className="text-sm font-semibold text-brand hover:underline"
        >
          ← Volver a la venta
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

      <Contrato c={c} />
    </main>
  );
}
