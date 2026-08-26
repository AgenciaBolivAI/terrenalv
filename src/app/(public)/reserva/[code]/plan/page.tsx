import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PrintButton } from '@/features/admin/contabilidad/PrintButton';
import { EstadoDeCuenta } from '@/features/admin/planes/EstadoDeCuenta';
import { cargarEstadoDeCuenta } from '@/features/admin/planes/estado-de-cuenta';

export const metadata: Metadata = {
  title: 'Mi estado de cuenta',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

// EL ENLACE QUE NO SE MUERE.
//
// Es el que se le manda por WhatsApp y el que va a abrir todos los meses. Si
// el código existe, la página existe — cambia lo que muestra, no si carga:
// juntando la cuota inicial, pagando cuotas, ya pagado, o cedido por
// traspaso. Y se arma desde la base en cada visita, así que el pago que la
// oficina registró hace diez minutos ya está.
export default async function EstadoDeCuentaPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const d = await cargarEstadoDeCuenta(decodeURIComponent(code));
  if (!d) notFound();

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

      <EstadoDeCuenta d={d} />

      <p className="mt-4 text-center text-xs text-stone-400 print:hidden">
        Guardá este enlace: es tuyo y se actualiza solo con cada pago.
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
