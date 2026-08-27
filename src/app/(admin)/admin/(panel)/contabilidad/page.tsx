import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import AccountingClient from '@/features/admin/contabilidad/AccountingClient';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import { EmptyState } from '@/features/admin/ui/bits';
import { isAccounting } from '@/features/admin/lib/roles';

export const metadata: Metadata = { title: 'Contabilidad' };
export const dynamic = 'force-dynamic';

const TABS = [
  'resumen', 'cobrar', 'egresos', 'bancos', 'directorio',
  'libro', 'estados', 'comprobantes', 'gestion',
] as const;
type Tab = (typeof TABS)[number];

export default async function ContabilidadPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }
  // Los egresos (sueldos, comisiones) están restringidos en la RLS a admin y
  // contabilidad; la página sigue la misma regla.
  // Manda el acceso resuelto por la base (rol + permisos por persona), no el
  // rol a secas: un permiso concedido a mano abre la puerta, y un recorte la
  // cierra. Sin permiso explícito, el rol decide como siempre.
  if ((ctx.acceso?.['contabilidad'] ?? (isAccounting(ctx.profile.role) ? 'edita' : 'no')) === 'no') {
    return (
      <EmptyState
        title="Sección restringida"
        hint="La contabilidad del proyecto no está disponible para el rol de ventas."
      />
    );
  }
  if (!ctx.project) {
    return <EmptyState title="Proyecto no encontrado" hint="Ejecuta las migraciones." />;
  }

  const { tab } = await searchParams;
  const initialTab = (TABS as readonly string[]).includes(tab ?? '') ? (tab as Tab) : 'resumen';

  return (
    <AccountingClient
      projectId={ctx.project.id}
      projects={ctx.projects}
      initialTab={initialTab}
    />
  );
}
