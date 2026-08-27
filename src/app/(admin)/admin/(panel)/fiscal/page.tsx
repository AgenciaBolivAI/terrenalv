import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import FiscalClient from '@/features/admin/fiscal/FiscalClient';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import { EmptyState } from '@/features/admin/ui/bits';
import { isAccounting } from '@/features/admin/lib/roles';

export const metadata: Metadata = { title: 'Contabilidad fiscal' };
export const dynamic = 'force-dynamic';

// El libro que se declara. Es un módulo aparte del gerencial a propósito: se
// sirve de él, pero el gerencial no sabe que existe. La separación está
// hecha en la base y vigilada por verificar_integridad().
export default async function FiscalPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }
  // Manda el acceso resuelto por la base (rol + permisos por persona), no el
  // rol a secas: un permiso concedido a mano abre la puerta, y un recorte la
  // cierra. Sin permiso explícito, el rol decide como siempre.
  if ((ctx.acceso?.['fiscal'] ?? (isAccounting(ctx.profile.role) ? 'edita' : 'no')) === 'no') {
    return (
      <EmptyState
        title="Sección restringida"
        hint="La contabilidad fiscal la maneja Contabilidad."
      />
    );
  }
  if (!ctx.project) {
    return <EmptyState title="Urbanización no encontrada" hint="Ejecutá las migraciones." />;
  }

  return <FiscalClient />;
}
