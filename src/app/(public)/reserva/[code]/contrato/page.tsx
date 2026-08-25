import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PrintButton } from '@/features/admin/contabilidad/PrintButton';
import { Contrato } from '@/features/contracts/ContratoDoc';
import { cargarContrato } from '@/features/contracts/contrato';

export const metadata: Metadata = { title: 'Contrato', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

// El contrato del comprador, en su propia página de seguimiento — protegido
// con el código que ya tiene, igual que sus recibos. Así el papel viaja por
// WhatsApp sin pedir contraseñas.
export default async function ContratoCompradorPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const c = await cargarContrato({ trackingCode: decodeURIComponent(code) });
  if (!c) notFound();

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

      <Contrato c={c} />

      <p className="mt-4 text-center text-xs text-stone-400 print:hidden">
        La firma se realiza en la oficina de Terrenalv.
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
