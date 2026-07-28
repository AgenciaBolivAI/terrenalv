// /reservar/[lotId] — guest reservation form.
// RSC fetches the lot with the ANON client (RLS: only published lots of active
// projects are visible) and the live price via get_lot_statuses. Defensive by
// contract: with no Supabase env or an empty DB it renders honest fallbacks.

import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { computeFinancing, type FinancingBreakdown } from '@/lib/financing';
import { loadFinancingPlan } from '@/lib/server/financing';
import { getSetting } from '@/lib/server/settings';
import { LotSummaryCard } from '@/features/reservations/components/LotSummaryCard';
import { PublicShell } from '@/features/reservations/components/PublicShell';
import { ReserveForm } from '@/features/reservations/components/ReserveForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Reservar lote',
  robots: { index: false, follow: false },
};

const FALLBACK_MAP = '/estrellas-del-sur/mapa';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ManzanaRel {
  code: string;
  sector: string | null;
}

interface LotRow {
  id: string;
  number: string;
  area_m2: number;
  frontage_m: number | null;
  depth_m: number | null;
  status: string;
  project_id: string;
  manzana_id: string;
  manzanas: ManzanaRel | ManzanaRel[] | null;
}

interface StatusEntry {
  id: string;
  st: string;
  priced: boolean;
  price: number | null;
}

type LoadResult =
  | { state: 'not_ready' }
  | { state: 'unavailable'; reason: 'taken' | 'unpriced'; mapHref: string }
  | {
      state: 'ok';
      lot: LotRow;
      manzana: ManzanaRel;
      price: number;
      currency: 'USD' | 'BOB';
      projectName: string;
      mapHref: string;
      sena: { amount: number; currency: 'USD' | 'BOB' } | null;
      financing: FinancingBreakdown | null;
    };

function firstRel<T>(rel: T | T[] | null): T | null {
  return Array.isArray(rel) ? (rel[0] ?? null) : (rel ?? null);
}

async function estimateSena(
  projectId: string,
  price: number,
  currency: 'USD' | 'BOB',
): Promise<{ amount: number; currency: 'USD' | 'BOB' } | null> {
  // Best effort — the reserve_amount setting is not public, so this needs the
  // admin client. Any failure → null (the exact amount shows after reserving).
  try {
    const admin = createAdminClient();
    const reserve = await getSetting<{ type?: string; value?: number; currency?: string } | null>(
      admin,
      projectId,
      'reserve_amount',
      null,
    );
    if (!reserve || typeof reserve !== 'object') return null;
    if (reserve.type === 'fijo' && typeof reserve.value === 'number') {
      return { amount: reserve.value, currency: reserve.currency === 'USD' ? 'USD' : 'BOB' };
    }
    if (reserve.type === 'porcentaje' && typeof reserve.value === 'number') {
      return { amount: Math.round(price * reserve.value) / 100, currency };
    }
    if (reserve.type === 'total') {
      return { amount: price, currency };
    }
    return null;
  } catch {
    return null;
  }
}

async function loadData(lotId: string): Promise<LoadResult> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('lots')
      .select('id, number, area_m2, frontage_m, depth_m, status, project_id, manzana_id, manzanas(code, sector)')
      .eq('id', lotId)
      .maybeSingle();
    if (error) return { state: 'not_ready' };
    if (!data) return { state: 'unavailable', reason: 'taken', mapHref: FALLBACK_MAP };
    const lot = data as unknown as LotRow;
    const manzana = firstRel(lot.manzanas) ?? { code: '—', sector: null };

    const [projectRes, statusesRes] = await Promise.all([
      supabase
        .from('projects')
        .select('slug, name, currency')
        .eq('id', lot.project_id)
        .maybeSingle(),
      supabase.rpc('get_lot_statuses', { p_project_id: lot.project_id }),
    ]);
    const project = projectRes.data as { slug: string; name: string; currency: 'USD' | 'BOB' } | null;
    const mapHref = project?.slug ? `/${project.slug}/mapa` : FALLBACK_MAP;

    const entries = ((statusesRes.data as { lots?: StatusEntry[] } | null)?.lots ?? []) as StatusEntry[];
    const entry = entries.find((l) => l.id === lot.id);
    const liveStatus = entry?.st ?? lot.status;
    const price = entry?.price ?? null;
    const priced = entry ? entry.priced === true && typeof price === 'number' && price > 0 : false;

    if (liveStatus !== 'disponible') {
      return { state: 'unavailable', reason: 'taken', mapHref };
    }
    if (!priced || price === null) {
      return { state: 'unavailable', reason: 'unpriced', mapHref };
    }

    const currency = project?.currency ?? 'USD';
    const [sena, plan] = await Promise.all([
      estimateSena(lot.project_id, price, currency),
      loadFinancingPlan(supabase, lot.project_id),
    ]);

    return {
      state: 'ok',
      lot,
      manzana,
      price,
      currency,
      projectName: project?.name ?? 'Estrellas del Sur',
      mapHref,
      sena,
      financing: computeFinancing(price, plan),
    };
  } catch {
    return { state: 'not_ready' };
  }
}

// Every state below renders inside <PublicShell>: Terrenalv header + BolivAI footer.

function FriendlyCard({
  title,
  body,
  mapHref,
}: {
  title: string;
  body: string;
  mapHref: string;
}) {
  return (
    <section className="mt-10 rounded-2xl border border-stone-200 bg-white p-6 text-center shadow-sm">
      <h1 className="text-xl font-extrabold text-stone-900">{title}</h1>
      <p className="mt-2 text-sm text-stone-600">{body}</p>
      <Link
        href={mapHref}
        className="mt-5 inline-block w-full rounded-xl bg-brand px-4 py-3.5 text-base font-bold text-white active:bg-brand-light"
      >
        Ver lotes disponibles
      </Link>
    </section>
  );
}

export default async function ReservarLotePage({
  params,
}: {
  params: Promise<{ lotId: string }>;
}) {
  const { lotId } = await params;
  if (!UUID_RE.test(lotId)) {
    return (
      <PublicShell>
        <FriendlyCard
          title="Lote no encontrado"
          body="El enlace no es válido. Elige tu lote desde el mapa."
          mapHref={FALLBACK_MAP}
        />
      </PublicShell>
    );
  }

  const result = await loadData(lotId);

  if (result.state === 'not_ready') {
    return (
      <PublicShell>
        <FriendlyCard
          title="Mapa en preparación"
          body="Las reservas en línea estarán disponibles muy pronto. Vuelve a intentarlo en unos minutos."
          mapHref={FALLBACK_MAP}
        />
      </PublicShell>
    );
  }

  if (result.state === 'unavailable') {
    return (
      <PublicShell>
        <FriendlyCard
          title={
            result.reason === 'taken'
              ? 'Este lote ya no está disponible'
              : 'Este lote aún no está habilitado'
          }
          body={
            result.reason === 'taken'
              ? 'Alguien más lo reservó o ya fue vendido. En el mapa puedes elegir otro lote parecido.'
              : 'Este lote todavía no está habilitado para reservas en línea. Contáctanos por WhatsApp para más información o elige otro lote del mapa.'
          }
          mapHref={result.mapHref}
        />
      </PublicShell>
    );
  }

  const { lot, manzana, price, currency, projectName, mapHref, sena, financing } = result;

  return (
    <PublicShell>
      <Link href={mapHref} className="text-sm font-semibold text-brand underline-offset-2">
        ← Volver al mapa
      </Link>
      <h1 className="mt-2 text-2xl font-extrabold text-stone-900">Reservar lote</h1>
      <p className="text-sm text-stone-500">{projectName}</p>

      <div className="mt-4">
        <LotSummaryCard
          manzana={manzana.code}
          lote={lot.number}
          sector={manzana.sector}
          areaM2={lot.area_m2}
          frontageM={lot.frontage_m}
          depthM={lot.depth_m}
          price={price}
          currency={currency}
          amountDue={sena?.amount ?? null}
          amountDueCurrency={sena?.currency ?? 'BOB'}
          financing={financing}
        />
      </div>

      <p className="mt-3 rounded-xl bg-green-50 p-3 text-xs text-stone-600">
        {sena
          ? 'Hoy pagas solo la seña para asegurar tu lote. Se aplica al precio total; el saldo se coordina con la oficina.'
          : 'Pagas una seña para asegurar tu lote. El monto exacto y las instrucciones de pago aparecen al confirmar tu reserva.'}
      </p>

      <div className="mt-5">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand">
          Tus datos
        </h2>
        <ReserveForm
          lotId={lot.id}
          mapHref={mapHref}
          lotLabel={`Manzana ${manzana.code} · Lote ${lot.number}`}
        />
      </div>
    </PublicShell>
  );
}
