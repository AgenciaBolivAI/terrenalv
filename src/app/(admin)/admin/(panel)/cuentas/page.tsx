import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import CuentasClient from '@/features/admin/cuentas/CuentasClient';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import { EmptyState } from '@/features/admin/ui/bits';
import { isAccounting } from '@/features/admin/lib/roles';

export const metadata: Metadata = { title: 'Ficha de clientes' };
export const dynamic = 'force-dynamic';

// La MISMA gente que «Clientes», pero sin un solo importe: quién es, dónde
// vive, cómo se llega hasta él, y de cada compra nada más que la modalidad
// (contado, crédito, traspaso) y la fecha.
//
// Es dato comercial, no plata: ventas la necesita tanto como contabilidad, y
// por eso esta pantalla se puede abrir sin ver la plata de nadie.
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
