import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import LoteHistorial from '@/features/admin/clientes/LoteHistorial';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';

export const metadata: Metadata = { title: 'Historial del lote' };
export const dynamic = 'force-dynamic';

// El historial de un lote, en pantalla propia. Vive bajo Clientes a
// propósito: es la ficha de lo que pasó con ESE lote, y el código del lote
// manda arriba de todo para que nadie confunda un lote con otro.
export default async function LotePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }
  const { id } = await params;
  return <LoteHistorial reservationId={id} />;
}
