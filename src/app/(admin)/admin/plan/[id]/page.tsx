import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import { PrintButton } from '@/features/admin/contabilidad/PrintButton';
import { EnviarPlanPdfWhatsapp, PlanPdfButton } from '@/features/admin/planes/PlanPdfButton';
import { EstadoDeCuenta } from '@/features/admin/planes/EstadoDeCuenta';
import { cargarEstadoDeCuenta } from '@/features/admin/planes/estado-de-cuenta';

export const metadata: Metadata = { title: 'Plan de pago' };
export const dynamic = 'force-dynamic';

// El cronograma para imprimir y entregar. Fuera del shell del panel a
// propósito: al imprimir no debe salir la navegación.
export default async function PlanImpresoPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }

  // `id` puede ser el id del plan o el código de seguimiento: los dos llegan
  // acá desde pantallas distintas y ninguno debería dar 404.
  const { id } = await params;
  const d = await cargarEstadoDeCuenta(id);
  if (!d) notFound();

  return (
    <main className="mx-auto max-w-3xl p-6 print:p-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <a href="/admin/planes" className="text-sm font-semibold text-brand hover:underline">
          ← Volver a Planes
        </a>
        <div className="flex flex-wrap items-center gap-2">
          <EnviarPlanPdfWhatsapp d={d} />
          <PlanPdfButton d={d} />
          <a
            href={`/reserva/${encodeURIComponent(d.tracking_code)}/plan`}
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

      <EstadoDeCuenta d={d} />
    </main>
  );
}
