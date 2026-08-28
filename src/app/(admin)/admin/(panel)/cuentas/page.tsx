import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import CuentasClient from '@/features/admin/cuentas/CuentasClient';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import { EmptyState } from '@/features/admin/ui/bits';
import { isAccounting } from '@/features/admin/lib/roles';

export const metadata: Metadata = { title: 'Cuentas de clientes' };
export const dynamic = 'force-dynamic';

// Los clientes REGISTRADOS en la web — distinto de «Clientes», que son los que
// ya compraron. Acá están también los que crearon cuenta y todavía no
// compraron: esa es la lista para trabajar, y la razón de pedir el alta.
//
// Es dato comercial, no plata: ventas la necesita tanto como contabilidad.
export default async function CuentasPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }
  if ((ctx.acceso?.['cuentas'] ?? (isAccounting(ctx.profile.role) ? 'edita' : 'edita')) === 'no') {
    return (
      <EmptyState
        title="Sección restringida"
        hint="Tu cuenta no tiene habilitadas las cuentas de clientes. Pedilas en Equipo."
      />
    );
  }

  return <CuentasClient />;
}
