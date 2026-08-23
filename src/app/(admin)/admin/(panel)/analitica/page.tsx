import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import AnalyticsClient from '@/features/admin/analitica/AnalyticsClient';
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
  // Incluye montos vendidos y rendimiento por persona: admin solamente.
  if (!isAccounting(ctx.profile.role)) {
    return (
      <EmptyState
        title="Sección restringida"
        hint="La analítica del proyecto no está disponible para el rol de ventas."
      />
    );
  }
  if (!ctx.project) {
    return <EmptyState title="Proyecto no encontrado" hint="Ejecuta las migraciones." />;
  }

  // Se le pasan TODAS las urbanizaciones: el filtro de alcance vive en el
  // cliente, así que una urbanización nueva aparece sola, sin tocar código.
  return <AnalyticsClient projectId={ctx.project.id} projects={ctx.projects} />;
}
