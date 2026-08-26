import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import AnalyticsClient from '@/features/admin/analitica/AnalyticsClient';
import MiAnalitica from '@/features/admin/analitica/MiAnalitica';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import { EmptyState } from '@/features/admin/ui/bits';
import { isAccounting } from '@/features/admin/lib/roles';

export const metadata: Metadata = { title: 'Analítica' };
export const dynamic = 'force-dynamic';

export default async function AnaliticaPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }
  // Cada uno ve la analítica que le corresponde: la de la EMPRESA si su
  // acceso lo dice, o LA SUYA — sus ventas, su comisión — si es 'propia'.
  // Un vendedor ya no choca contra una pared: ve sus propios números.
  const nivel =
    ctx.acceso?.['analitica'] ?? (isAccounting(ctx.profile.role) ? 'empresa' : 'propia');
  if (nivel === 'no') {
    return (
      <EmptyState
        title="Sección restringida"
        hint="Tu cuenta no tiene habilitada la analítica. Pedila en Equipo."
      />
    );
  }
  if (nivel === 'propia') {
    return <MiAnalitica />;
  }
  if (!ctx.project) {
    return <EmptyState title="Proyecto no encontrado" hint="Ejecuta las migraciones." />;
  }

  // Se le pasan TODAS las urbanizaciones: el filtro de alcance vive en el
  // cliente, así que una urbanización nueva aparece sola, sin tocar código.
  return <AnalyticsClient projectId={ctx.project.id} projects={ctx.projects} />;
}
