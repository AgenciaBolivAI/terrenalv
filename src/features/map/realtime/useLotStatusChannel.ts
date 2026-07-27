'use client';

// Live lot-status wiring: one public broadcast topic per project, one event.
// Events patch the store per-lot; any detected gap (statusRev jump), tab
// wake-up, or channel resubscribe triggers a full snapshot refetch. No-op in
// seed mode or when Supabase env vars are absent.

import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { LotStatus } from '@/lib/db-types';
import { loadStatuses } from '../data/loadStatuses';
import type { LotStatusEvent } from '../data/types';
import { useMapStore } from '../store/useMapStore';

const VALID_STATUSES: ReadonlySet<string> = new Set([
  'disponible',
  'reservado',
  'vendido',
  'no_disponible',
]);

const MIN_RESYNC_GAP_MS = 5000;

export function useLotStatusChannel(projectId: string | null): void {
  const resyncingRef = useRef(false);
  const lastResyncRef = useRef(0);

  useEffect(() => {
    if (
      !projectId ||
      projectId.startsWith('seed-') ||
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ) {
      return;
    }

    const supabase = createClient();
    let disposed = false;

    const resync = async (force = false) => {
      const now = Date.now();
      if (resyncingRef.current) return;
      if (!force && now - lastResyncRef.current < MIN_RESYNC_GAP_MS) return;
      resyncingRef.current = true;
      lastResyncRef.current = now;
      try {
        // No fallback lot ids on purpose: a failed refetch must NOT overwrite
        // real data with fabricated 'disponible' entries.
        const snap = await loadStatuses(projectId);
        if (snap && !disposed) {
          useMapStore.getState().applyStatusSnapshot(snap.status_rev, snap.server_now, snap.lots);
        } else if (!disposed) {
          useMapStore.getState().setNeedsStatusResync(false);
        }
      } finally {
        resyncingRef.current = false;
      }
    };

    // Store-driven resync: applyStatusEvent flags a rev gap.
    const unsubscribeStore = useMapStore.subscribe(
      (s) => s.needsStatusResync,
      (needs) => {
        if (needs) void resync(true);
      },
    );

    // Tab wake-up / refocus: events were likely dropped while asleep.
    const onFocus = () => void resync();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void resync();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    let hadFirstSubscribe = false;
    const channel = supabase.channel(`project:${projectId}:lots`, {
      config: { broadcast: { self: true }, private: false },
    });
    channel
      .on('broadcast', { event: 'lot_status' }, (message) => {
        const payload = message.payload as Partial<LotStatusEvent> | undefined;
        if (
          !payload ||
          typeof payload.lot_id !== 'string' ||
          typeof payload.status !== 'string' ||
          !VALID_STATUSES.has(payload.status) ||
          typeof payload.status_rev !== 'number'
        ) {
          return;
        }
        useMapStore
          .getState()
          .applyStatusEvent(payload.lot_id, payload.status as LotStatus, payload.status_rev);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // First SUBSCRIBED right after SSR data is fresh; later ones mean we
          // were offline for a while → pull a snapshot to close the gap.
          if (hadFirstSubscribe) void resync(true);
          hadFirstSubscribe = true;
        }
      });

    return () => {
      disposed = true;
      unsubscribeStore();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      void supabase.removeChannel(channel);
    };
  }, [projectId]);
}
