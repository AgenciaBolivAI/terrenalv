import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import ComisionesClient from '@/features/admin/comisiones/ComisionesClient';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import { EmptyState } from '@/features/admin/ui/bits';
import { isAccounting } from '@/features/admin/lib/roles';

export const metadata: Metadata = { title: 'Comisiones' };
export const dynamic = 'force-dynamic';

// Lo que le toca a cada vendedor. Restringido como Contabilidad: son sueldos
// de la gente, y pagar una comisión saca plata de una caja.
export default async function ComisionesPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }
  // Manda el acceso resuelto por la base (rol + permisos por persona), no el
  // rol a secas: un permiso concedido a mano abre la puerta, y un recorte la
  // cierra. Sin permiso explícito, el rol decide como siempre.
  if ((ctx.acceso?.['comisiones'] ?? (isAccounting(ctx.profile.role) ? 'edita' : 'no')) === 'no') {
    return (
      <EmptyState
        title="Sección restringida"
        hint="Las comisiones del equipo las maneja Contabilidad."
      />
    );
  }

  return <ComisionesClient />;
}
