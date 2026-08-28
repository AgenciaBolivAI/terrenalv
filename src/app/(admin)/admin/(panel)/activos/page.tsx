import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import ActivosClient from '@/features/admin/activos/ActivosClient';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import { EmptyState } from '@/features/admin/ui/bits';
import { isAccounting } from '@/features/admin/lib/roles';

export const metadata: Metadata = { title: 'Activos fijos' };
export const dynamic = 'force-dynamic';

export default async function ActivosPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }
  // Manda el acceso resuelto por la base (rol + permisos por persona), no el
  // rol a secas: un permiso concedido a mano abre la puerta, y un recorte la
  // cierra. Sin permiso explícito, el rol decide como siempre.
  if ((ctx.acceso?.['activos'] ?? (isAccounting(ctx.profile.role) ? 'edita' : 'no')) === 'no') {
    return <EmptyState title="Sección restringida" hint="Los activos fijos los maneja Contabilidad." />;
  }
  if (!ctx.project) {
    return <EmptyState title="Sin urbanizaciones" hint="Creá una urbanización antes de cargar activos." />;
  }
  // Con Administración incluida: la computadora de la oficina no es de ninguna
  // urbanización, pero es un activo de la empresa igual.
  return <ActivosClient projectId={ctx.project.id} projects={ctx.projects} />;
}
