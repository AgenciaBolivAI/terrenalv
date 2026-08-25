import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PrintButton } from '@/features/admin/contabilidad/PrintButton';
import { Recibo } from '@/features/reservations/components/Recibo';
import { cargarRecibo } from '@/features/reservations/recibo';

export const metadata: Metadata = { title: 'Recibo' };
export const dynamic = 'force-dynamic';

// El recibo del comprador, en su propia página de seguimiento.
//
// Sin esto no había forma de MANDARLE el recibo: el único que existía vivía
// bajo /admin y pedía sesión, así que el comprador abría el enlace y le pedían
// contraseña.
//
// Se protege con el código de seguimiento, que es el secreto que ya tiene: la
// carga exige que el pago pertenezca a ESA reserva, así que adivinar el id de
// un pago ajeno no muestra nada. Es la misma llave con la que ya ve su reserva
// y sube su comprobante.
export default async function ReciboCompradorPage({
  params,
}: {
  params: Promise<{ code: string; pagoId: string }>;
}) {
  const { code, pagoId } = await params;
  const r = await cargarRecibo(pagoId, code.toUpperCase());
  if (!r) notFound();

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6 print:p-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link
          href={`/reserva/${encodeURIComponent(code)}`}
          className="text-sm font-semibold text-brand hover:underline"
        >
          ← Mi reserva
        </Link>
        <PrintButton />
      </div>

      <Recibo r={r} />

      <p className="mt-4 text-center text-xs text-stone-500 print:hidden">
        Guardá este recibo. Podés volver a abrirlo cuando quieras desde tu enlace de seguimiento.
      </p>
    </main>
  );
}
