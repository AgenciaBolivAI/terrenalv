import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import FinanciamientoClient from '@/features/admin/financiamiento/FinanciamientoClient';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import { EmptyState } from '@/features/admin/ui/bits';
import { isAccounting } from '@/features/admin/lib/roles';

export const metadata: Metadata = { title: 'Financiamiento' };
export const dynamic = 'force-dynamic';

// Las condiciones de crédito por rango de precio: cuánta inicial, cuánto
// interés y a cuántos meses. Restringido como Contabilidad — define lo que la
// empresa cobra, no solo cómo se muestra.
export default async function FinanciamientoPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }
  if (!isAccounting(ctx.profile.role)) {
    return (
      <EmptyState
        title="Sección restringida"
        hint="Las condiciones de financiamiento las maneja Contabilidad."
      />
    );
  }

  return (
    <FinanciamientoClient
      projects={ctx.projects.map((p) => ({ id: p.id, name: p.name }))}
    />
  );
}
