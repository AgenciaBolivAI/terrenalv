import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import { isAccounting } from '@/features/admin/lib/roles';
import { EmptyState } from '@/features/admin/ui/bits';
import { PrintButton } from '@/features/admin/contabilidad/PrintButton';
import {
  ComprobanteAsiento,
  type CuentaPlan,
  type LineaLibro,
} from '@/features/admin/contabilidad/ComprobanteAsiento';

export const metadata: Metadata = { title: 'Comprobante contable' };
export const dynamic = 'force-dynamic';

// El papel de los asientos que no tienen otro papel: activo fijo, fondo a
// rendir, pago a proveedor, compra de terreno, asiento manual. Se busca por
// NÚMERO de comprobante (no por uuid) porque el número es lo que la contadora
// ve en el registro y lo que se archiva.
//
// Vive fuera del shell del panel a propósito: al imprimir no debe salir la
// navegación, igual que el recibo y el egreso.
export default async function ComprobantePage({
  params,
}: {
  params: Promise<{ numero: string }>;
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }
  // La misma puerta que la pantalla de contabilidad: manda el acceso resuelto
  // por la base (rol + permisos por persona), no el rol a secas. La vista ya
  // está gateada del lado de la base; esto solo evita mostrar un 404 confuso
  // a quien no tiene la sección.
  if ((ctx.acceso?.['contabilidad'] ?? (isAccounting(ctx.profile.role) ? 'edita' : 'no')) === 'no') {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <EmptyState
          title="Sección restringida"
          hint="La contabilidad del proyecto no está disponible para el rol de ventas."
        />
      </main>
    );
  }

  const { numero } = await params;
  const supabase = await createClient();
  // Débitos primero: así se lee un comprobante en papel.
  const { data } = await supabase
    .from('v_libro_diario')
    .select('*')
    .eq('comprobante', decodeURIComponent(numero))
    .order('debe', { ascending: false });
  if (!data?.length) notFound();
  const lineas = data as unknown as LineaLibro[];

  // El libro lleva la cuenta interna ('1131'); el papel muestra el código del
  // plan que mandaron y el nombre, resueltos contra el plan de cuentas.
  const codigos = [...new Set(lineas.map((l) => l.cuenta))];
  const { data: cuentas } = await supabase
    .from('chart_of_accounts')
    .select('code, codigo_plan, name')
    .in('code', codigos);
  const plan: Record<string, CuentaPlan | undefined> = {};
  for (const c of (cuentas ?? []) as { code: string; codigo_plan: string | null; name: string }[]) {
    plan[c.code] = { codigo: c.codigo_plan ?? c.code, nombre: c.name };
  }

  const proyecto = ctx.projects.find((p) => p.id === lineas[0].project_id)?.name ?? '—';

  return (
    <main className="mx-auto max-w-3xl p-6 print:p-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <a
          href="/admin/contabilidad?tab=comprobantes"
          className="text-sm font-semibold text-brand hover:underline"
        >
          ← Volver a comprobantes
        </a>
        <PrintButton />
      </div>
      <ComprobanteAsiento lineas={lineas} proyecto={proyecto} plan={plan} />
    </main>
  );
}
