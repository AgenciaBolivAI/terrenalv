// Lot status snapshot loader (isomorphic: RSC page + client resyncs).
//
// Fallback semantics are deliberate:
//  * `fallbackLotIds` provided (initial page load, no DB / RPC down) → every lot
//    renders 'disponible' WITHOUT price, so nothing is reservable but the plat
//    is browsable. No business data is invented.
//  * omitted (client resync path) → failures return null and the caller keeps
//    the last known state instead of clobbering it with fabricated statuses.

import { createClient as createAnonClient } from '@supabase/supabase-js';
import {
  BUILTIN_ANON_KEY,
  CAN_RETRY_BUILTIN,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from '@/lib/supabase/config';
import type { LotStatusEntry, StatusSnapshot } from './types';

function fallbackSnapshot(lotIds: string[]): StatusSnapshot {
  return {
    status_rev: 0,
    server_now: new Date().toISOString(),
    lots: lotIds.map((id) => ({ id, st: 'disponible' as const, priced: false, price: null })),
  };
}

function isValid(x: unknown): x is StatusSnapshot {
  if (!x || typeof x !== 'object') return false;
  const s = x as StatusSnapshot;
  return Array.isArray(s.lots) && typeof s.server_now === 'string';
}

export async function loadStatuses(
  projectId: string,
  fallbackLotIds?: string[],
  keyOverride?: string,
): Promise<StatusSnapshot | null> {
  const url = SUPABASE_URL;
  const key = keyOverride ?? SUPABASE_ANON_KEY;

  if (projectId.startsWith('seed-') || !url || !key) {
    return fallbackLotIds ? fallbackSnapshot(fallbackLotIds) : null;
  }

  try {
    const supabase = createAnonClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase
      .rpc('get_lot_statuses', { p_project_id: projectId })
      .abortSignal(AbortSignal.timeout(8000));
    if (error || !isValid(data)) {
      // Same self-heal as the geometry loader: a rejected env key must not make
      // every lot look unavailable.
      if (
        error &&
        /invalid api key|jwt|unauthorized|api key/i.test(error.message) &&
        !keyOverride &&
        CAN_RETRY_BUILTIN
      ) {
        return loadStatuses(projectId, fallbackLotIds, BUILTIN_ANON_KEY);
      }
      return fallbackLotIds ? fallbackSnapshot(fallbackLotIds) : null;
    }
    const snapshot = data as StatusSnapshot;
    const lots: ({ id: string } & LotStatusEntry)[] = [];
    for (const l of snapshot.lots) {
      if (l && typeof l.id === 'string') {
        lots.push({
          id: l.id,
          st: l.st,
          priced: !!l.priced,
          price: typeof l.price === 'number' ? l.price : null,
        });
      }
    }
    return {
      status_rev: Number.isFinite(snapshot.status_rev) ? snapshot.status_rev : 0,
      server_now: snapshot.server_now,
      lots,
    };
  } catch {
    return fallbackLotIds ? fallbackSnapshot(fallbackLotIds) : null;
  }
}
