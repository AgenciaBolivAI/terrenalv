// /reserva/[code] — the buyer's tracking page (capability URL, WhatsApp-forwardable).
// The RSC calls the shared server status function directly (no HTTP round-trip to
// our own API) and hands the payload to the client TrackingView.

import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { hashClientIp } from '@/lib/server/client-ip';
import { fetchReservationStatus } from '@/features/reservations/server/getStatus';
import { safeDecode } from '@/features/reservations/lib/api';
import { PublicShell } from '@/features/reservations/components/PublicShell';
import { TrackingView } from '@/features/reservations/components/TrackingView';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Seguimiento de reserva',
  robots: { index: false, follow: false },
};

const MAP_URL = '/prados-del-sur/mapa';

function ErrorShell({
  title,
  body,
  showSearch,
}: {
  title: string;
  body: string;
  showSearch: boolean;
}) {
  return (
    <PublicShell>
      <div className="pt-6">
        <section className="rounded-2xl border border-stone-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-extrabold text-stone-900">{title}</h1>
          <p className="mt-2 text-sm text-stone-600">{body}</p>
          <div className="mt-5 space-y-2">
            {showSearch ? (
              <Link
                href="/reserva"
                className="block w-full rounded-xl bg-brand px-4 py-3.5 text-base font-bold text-white active:bg-brand-light"
              >
                Buscar mi reserva
              </Link>
            ) : null}
            <Link
              href={MAP_URL}
              className="block w-full rounded-xl border border-stone-300 px-4 py-3.5 text-base font-bold text-stone-700 active:bg-stone-100"
            >
              Ver lotes disponibles
            </Link>
          </div>
        </section>
      </div>
    </PublicShell>
  );
}

export default async function ReservaTrackingPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ nuevo?: string }>;
}) {
  const { code } = await params;
  const sp = await searchParams;
  const hdrs = await headers();
  const result = await fetchReservationStatus(
    safeDecode(code),
    hashClientIp(hdrs as unknown as Headers),
  );

  if (!result.ok) {
    if (result.status === 503) {
      return (
        <ErrorShell
          title="Servicio no disponible todavía"
          body="Estamos preparando el sistema de reservas. Intenta de nuevo en unos minutos."
          showSearch={false}
        />
      );
    }
    if (result.status === 429) {
      return (
        <ErrorShell
          title="Demasiados intentos"
          body="Espera unos minutos y vuelve a abrir este enlace."
          showSearch={false}
        />
      );
    }
    return (
      <ErrorShell
        title="Reserva no encontrada"
        body={`${result.error} Revisa que el enlace o el código estén completos.`}
        showSearch
      />
    );
  }

  return (
    <PublicShell>
      <TrackingView
        code={result.data.tracking_code}
        initial={result.data}
        nuevo={sp?.nuevo === '1'}
      />
    </PublicShell>
  );
}
