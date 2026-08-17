import 'server-only';

// Live numbers for the landing page. Everything here degrades to null — the
// landing must render (statically if need be) even with the database down, so
// every figure is optional and the page hides what it doesn't have.

import { createClient as createAnonClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/supabase/config';
import { createAdminClient } from '@/lib/supabase/admin';
import { computeFinancing, DEFAULT_BOB_PER_USD, type FinancingBreakdown } from '@/lib/financing';
import { loadFinancingPlan } from '@/lib/server/financing';
import { getSetting } from '@/lib/server/settings';

const SLUG = 'prados-del-sur';

export interface LandingData {
  /** Every lot on the published plano, whatever its status. */
  totalLotes: number | null;
  /** Lots reservable right now (status disponible, with a price). */
  disponibles: number | null;
  /** Cheapest priced lot. */
  desde: number | null;
  /** Median lot price — the honest "typical" example for the plan de pago. */
  tipico: number | null;
  currency: 'USD' | 'BOB';
  /** Plan de pago computed on the typical lot. */
  financing: FinancingBreakdown | null;
  /** Seña to pay today (reserve_amount is not public → best effort via admin). */
  sena: { amount: number; currency: 'USD' | 'BOB' } | null;
}

const EMPTY: LandingData = {
  totalLotes: null,
  disponibles: null,
  desde: null,
  tipico: null,
  currency: 'BOB',
  financing: null,
  sena: null,
};

interface StatusEntry {
  st: string;
  priced: boolean;
  price: number | null;
}

export async function loadLandingData(): Promise<LandingData> {
  try {
    const anon = createAnonClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });

    const { data: project } = await anon
      .from('projects')
      .select('id, currency')
      .eq('slug', SLUG)
      .maybeSingle();
    if (!project) return EMPTY;
    const currency: 'USD' | 'BOB' = project.currency === 'USD' ? 'USD' : 'BOB';

    const [{ data: statuses }, plan, rate] = await Promise.all([
      anon.rpc('get_lot_statuses', { p_project_id: project.id }),
      loadFinancingPlan(anon, project.id),
      // A cuota inicial quoted in Bs against a $us price needs the rate.
      getSetting<number>(anon, project.id, 'exchange_rate_bob_per_usd', DEFAULT_BOB_PER_USD)
        .catch(() => DEFAULT_BOB_PER_USD),
    ]);
    const bobPerUsd = typeof rate === 'number' && rate > 0 ? rate : DEFAULT_BOB_PER_USD;

    const lots = ((statuses as { lots?: StatusEntry[] } | null)?.lots ?? []) as StatusEntry[];
    const prices = lots
      .filter((l) => l.st === 'disponible' && l.priced && typeof l.price === 'number' && l.price > 0)
      .map((l) => l.price as number)
      .sort((a, b) => a - b);

    // Read from the map, never hard-coded: a figure typed into the page is a
    // figure that goes stale the next time the plano is re-seeded.
    const totalLotes = lots.length || null;
    const disponibles = prices.length || null;
    const desde = prices[0] ?? null;
    const tipico = prices.length ? prices[Math.floor(prices.length / 2)] : null;

    // reserve_amount is a private setting; the landing shows it when it can.
    let sena: LandingData['sena'] = null;
    try {
      const admin = createAdminClient();
      const reserve = await getSetting<{ type?: string; value?: number; currency?: string } | null>(
        admin,
        project.id,
        'reserve_amount',
        null,
      );
      if (reserve?.type === 'fijo' && typeof reserve.value === 'number') {
        sena = { amount: reserve.value, currency: reserve.currency === 'USD' ? 'USD' : 'BOB' };
      }
    } catch {
      /* landing shows the seña only when it can read it */
    }

    return {
      totalLotes,
      disponibles,
      desde,
      tipico,
      currency,
      financing: computeFinancing(tipico, plan, { currency, bobPerUsd }),
      sena,
    };
  } catch {
    return EMPTY;
  }
}
