'use client';

// Client-side status state for the tracking page.
//  * Snapshot pairs the payload with the client capture time → skew-proof countdowns.
//  * Refetches on mount (fresh server_now), on tab focus/visibility, and every
//    30 s while en_verificacion. Terminal statuses stop polling.

import { useCallback, useEffect, useRef, useState } from 'react';
import { updateActiveReservationStatus } from '@/lib/client/session-state';
import type { TrackedReservation } from '../lib/api';
import { fetchReservationStatusClient } from '../lib/api';

interface Snapshot {
  data: TrackedReservation;
  capturedAtMs: number;
}

export function useReservationStatus(code: string, initial: TrackedReservation) {
  const [snap, setSnap] = useState<Snapshot>(() => ({ data: initial, capturedAtMs: Date.now() }));
  const [staleWarning, setStaleWarning] = useState<string | null>(null);
  const inFlight = useRef(false);

  const refetch = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await fetchReservationStatusClient(code);
      if (result.ok) {
        setSnap({ data: result.data, capturedAtMs: Date.now() });
        setStaleWarning(null);
      } else if (result.code === 'NETWORK') {
        setStaleWarning('Sin conexión — mostrando el último estado conocido.');
      }
      // Other errors (rate limit, transient 5xx): keep the last snapshot silently.
    } finally {
      inFlight.current = false;
    }
  }, [code]);

  // Fresh server_now right after hydration.
  useEffect(() => {
    void refetch();
  }, [refetch]);

  const status = snap.data.status;

  // Keep this device's session anchor in sync — but only for a reservation this
  // device already owns. Auto-adopting any opened link would make a forwarded
  // WhatsApp link hijack the recipient's "Mi reserva" and show them someone
  // else's lot. Adoption happens exactly once, in ReserveForm, on success.
  useEffect(() => {
    updateActiveReservationStatus(code, status);
  }, [code, status]);
  const live =
    status === 'pendiente_pago' || status === 'en_verificacion' || status === 'rechazo_reintento';

  // Refetch when the buyer returns to the tab (WhatsApp → bank app → back).
  useEffect(() => {
    if (!live) return;
    const onFocus = () => void refetch();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refetch();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [live, refetch]);

  // Gentle polling while the team verifies.
  useEffect(() => {
    if (status !== 'en_verificacion') return;
    const id = setInterval(() => void refetch(), 30_000);
    return () => clearInterval(id);
  }, [status, refetch]);

  return { data: snap.data, capturedAtMs: snap.capturedAtMs, refetch, staleWarning };
}
