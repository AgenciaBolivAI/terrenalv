// Public interactive map page (RSC). Loads geometry + statuses server-side and
// hands plain JSON to the client shell. Degrades to an honest "Mapa en
// preparación" state when neither the database nor the seed file can serve.

import type { Metadata } from 'next';
import Link from 'next/link';
import { MapShell } from '@/features/map/2d/MapShell';
import { loadGeometry } from '@/features/map/data/loadGeometry';
import { loadStatuses } from '@/features/map/data/loadStatuses';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Mapa de lotes',
};

function MapaEnPreparacion() {
  return (
    <main className="flex h-[100dvh] flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="text-[11px] font-bold tracking-[0.25em] text-earth">TERRENALV</span>
      <h1 className="text-2xl font-bold text-brand">Mapa en preparación</h1>
      <p className="max-w-xs text-sm leading-relaxed text-stone-600">
        Estamos preparando el plano interactivo de la urbanización. Vuelve a intentarlo en unos
        minutos.
      </p>
      <Link
        href="/"
        className="mt-3 rounded-full bg-brand px-6 py-2.5 text-sm font-semibold text-white active:bg-brand-light"
      >
        Volver al inicio
      </Link>
    </main>
  );
}

export default async function MapaPage({
  params,
}: {
  params: Promise<{ projectSlug: string }>;
}) {
  const { projectSlug } = await params;

  const geo = await loadGeometry(projectSlug);
  if (!geo || geo.snapshot.manzanas.length === 0) {
    return <MapaEnPreparacion />;
  }

  const statuses = await loadStatuses(
    geo.project.projectId,
    geo.snapshot.lots.map((l) => l.id),
  );

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-[#eceae3]">
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center px-3 pt-3">
        <div className="pointer-events-auto flex w-full max-w-90 items-center justify-between gap-3 rounded-full bg-white/95 py-1.5 pl-4 pr-1.5 shadow-md backdrop-blur">
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-bold text-brand">{geo.project.name}</p>
            <p className="text-[9px] font-bold tracking-[0.22em] text-earth">TERRENALV</p>
          </div>
          <Link
            href="/"
            className="shrink-0 rounded-full bg-stone-100 px-3.5 py-2 text-xs font-semibold text-stone-700 active:bg-stone-200"
          >
            Inicio
          </Link>
        </div>
      </header>

      <MapShell snapshot={geo.snapshot} statuses={statuses} project={geo.project} />
    </div>
  );
}
