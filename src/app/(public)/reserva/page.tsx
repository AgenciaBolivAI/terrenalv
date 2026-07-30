// /reserva — "Buscar mi reserva": enter the tracking code, jump to the tracking page.

import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicShell } from '@/features/reservations/components/PublicShell';
import { SearchReservationForm } from '@/features/reservations/components/SearchReservationForm';

export const metadata: Metadata = {
  title: 'Buscar mi reserva',
  robots: { index: false, follow: false },
};

export default function BuscarReservaPage() {
  return (
    <PublicShell>
      <div className="pt-4">
        <h1 className="text-2xl font-extrabold text-stone-900">Buscar mi reserva</h1>
        <p className="mt-1 text-sm text-stone-600">
          Ingresa tu código de seguimiento para ver el estado de tu lote.
        </p>
        <div className="mt-5 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <SearchReservationForm />
        </div>
        <p className="mt-6 text-center text-sm text-stone-500">
          ¿Aún no tienes una reserva?{' '}
          <Link
            href="/prados-del-sur/mapa"
            className="font-semibold text-brand underline underline-offset-2"
          >
            Explora los lotes disponibles
          </Link>
        </p>
      </div>
    </PublicShell>
  );
}
