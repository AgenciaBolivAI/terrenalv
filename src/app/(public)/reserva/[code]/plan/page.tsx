import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PrintButton } from '@/features/admin/contabilidad/PrintButton';
import { PlanDePago } from '@/features/admin/planes/PlanDePago';
import { cargarPlanImpreso } from '@/features/admin/planes/plan-impreso';

export const metadata: Metadata = {
  title: 'Mi plan de pago',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

// El plan de pago del comprador, en su página de seguimiento — protegido con
// el código que ya tiene, igual que sus recibos y su contrato.
//
// Le sirve todos los meses: qué cuota le toca, qué día vence y cuánto le
// queda, sin llamar a la oficina.
export default async function PlanCompradorPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const p = await cargarPlanImpreso({ trackingCode: decodeURIComponent(code) });
  if (!p) notFound();

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6 print:p-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link
          href={`/reserva/${encodeURIComponent(code)}`}
          className="text-sm font-semibold text-brand hover:underline"
        >
          ← Mi reserva
        </Link>
        <PrintButton />
      </div>

      <PlanDePago p={p} />

      <p className="mt-4 text-center text-xs text-stone-400 print:hidden">
        Guardá este enlace: el cronograma se actualiza solo con cada pago que registres en
        oficina.
        <span className="mx-2">·</span>
        <a
          href="https://bolivai.com"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-stone-600"
        >
          Made by BolivAI
        </a>
      </p>
    </main>
  );
}
