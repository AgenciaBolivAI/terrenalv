import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import MercadoAdminClient from '@/features/admin/mercado/MercadoAdminClient';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import { EmptyState } from '@/features/admin/ui/bits';

export const metadata: Metadata = { title: 'Mercado' };
export const dynamic = 'force-dynamic';

// El mercado de traspasos, del lado del mostrador: qué lotes están ofrecidos,
// quién preguntó por cada uno, y el control total del aviso — precio pedido,
// nota, comisión, pausa o cierre. La vidriera es pública; el timón es de acá.
//
// Sin filtro de rol a propósito: ventas atiende a los interesados que llama la
// vidriera, y contabilidad cobra la comisión cuando el traspaso se firma.
export default async function MercadoPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }
  if (!ctx.project) {
    return <EmptyState title="Proyecto no encontrado" hint="Ejecuta las migraciones." />;
  }

  return <MercadoAdminClient />;
}
