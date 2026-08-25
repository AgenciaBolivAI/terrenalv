import type { Metadata } from 'next';
import { PublicShell } from '@/features/reservations/components/PublicShell';
import { MercadoPublicoClient } from '@/features/market/MercadoPublicoClient';

export const metadata: Metadata = {
  title: 'Mercado de traspasos — Terrenalv',
  description:
    'Lotes de Terrenalv ofrecidos en traspaso por sus compradores. Consulta por el que te interese: el traspaso se firma en oficina, con la empresa de por medio.',
};
export const dynamic = 'force-dynamic';

// La vidriera pública del mercado de traspasos.
//
// Muestra el LOTE — proyecto, manzana, superficie, saldo a asumir, precio
// pedido — y nunca al vendedor: el interesado deja su contacto y la oficina
// conecta a las partes. Terrenalv es dueña del lote hasta que se paga entero,
// así que ningún traspaso ocurre acá: acá se mira y se pregunta; se firma en
// el mostrador, con arrastre de pagos, recibos y libros.
export default function MercadoPage() {
  return (
    <PublicShell maxWidth="max-w-3xl">
      <MercadoPublicoClient />
    </PublicShell>
  );
}
