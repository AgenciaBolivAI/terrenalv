import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import ProjectsClient from '@/features/admin/proyectos/ProjectsClient';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import { EmptyState } from '@/features/admin/ui/bits';

export const metadata: Metadata = { title: 'Urbanizaciones' };
export const dynamic = 'force-dynamic';

export default async function ProyectosPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }
  // Dar de alta una urbanización y publicarla es decisión de dueño.
  if (ctx.profile.role !== 'admin') {
    return (
      <EmptyState
        title="Sección restringida"
        hint="Solo un administrador puede crear o publicar urbanizaciones."
      />
    );
  }
  return <ProjectsClient activeSlug={ctx.project?.slug ?? null} />;
}
