import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import MiCuentaClient from '@/features/admin/cuenta/MiCuentaClient';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';

export const metadata: Metadata = { title: 'Mi cuenta' };
export const dynamic = 'force-dynamic';

// Lo que cada miembro del equipo ve de SÍ MISMO: sus ventas y sus comisiones.
//
// Sin filtro de rol a propósito — es justamente la pantalla del vendedor, que
// no entra a Contabilidad. Los datos llegan por una función que filtra por la
// sesión, así que nadie ve lo del de al lado aunque cambie la URL.
export default async function MiCuentaPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }

  return <MiCuentaClient />;
}
