'use client';

// Mandar ESTE recibo al WhatsApp del comprador, desde la página del recibo.
//
// Es la pantalla donde uno está parado cuando quiere mandarlo, así que el
// botón tiene que estar acá — no solo en el momento de cobrar ni escondido en
// una lista. Arma el mensaje con el enlace del recibo del comprador (el que
// se abre con su código de seguimiento, sin cuenta ni contraseña).
//
// Es un componente de cliente porque necesita window.location.origin para
// armar el enlace absoluto; el recibo en sí sigue siendo servidor y se
// imprime aunque el navegador no ejecute nada.

import { waLink, formatMoney } from '@/lib/format';
import { IconWhatsapp } from '@/features/admin/ui/icons';

export function EnviarReciboWhatsapp({
  telefono,
  nombre,
  trackingCode,
  paymentId,
  concepto,
  monto,
  moneda,
}: {
  telefono: string | null;
  nombre: string;
  trackingCode: string;
  paymentId: string;
  concepto: string;
  monto: number;
  moneda: 'BOB' | 'USD';
}) {
  if (!telefono) {
    return (
      <span
        className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-400"
        title="Este comprador no tiene celular cargado. Agregalo desde Clientes y podrás mandarle el recibo."
      >
        Sin celular
      </span>
    );
  }

  const enlace =
    typeof window === 'undefined'
      ? ''
      : `${window.location.origin}/reserva/${encodeURIComponent(trackingCode)}/recibo/${paymentId}`;

  const texto =
    `Hola ${nombre.split(' ')[0] ?? ''}, aquí está tu recibo de ${concepto.toLowerCase()} ` +
    `por ${formatMoney(monto, moneda)} — Terrenalv S.R.L.: ${enlace}`;

  return (
    <a
      href={waLink(telefono, texto)}
      target="_blank"
      rel="noopener noreferrer"
      title={`Mandar este recibo al ${telefono}`}
      className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-700"
    >
      <IconWhatsapp className="h-4 w-4" />
      Enviar por WhatsApp
    </a>
  );
}
