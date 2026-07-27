// Client-safe types + fetch helpers for the guest reservation flow.
// (No server imports here — this file is shared by client components and the
// server route/page code.)

import type { CreateReservationPayload, ReservationStatusPayload } from '@/lib/db-types';

/** Status payload as served by our API: RPC payload + short-lived signed QR URL. */
export interface TrackedReservation extends ReservationStatusPayload {
  qr_url: string | null;
}

/** Create payload as served by our API. */
export interface CreateReservationResponse extends CreateReservationPayload {
  qr_url: string | null;
}

export interface ReservationApiError {
  error: string;
  code?: string | null;
}

export type StatusFetchResult =
  | { ok: true; data: TrackedReservation }
  | { ok: false; status: number; error: string; code: string | null };

const NETWORK_ERROR = 'Sin conexión. Revisa tu internet e intenta de nuevo.';

/** decodeURIComponent that never throws (malformed % sequences in pasted URLs). */
export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** GET /api/reservas/[code] from the browser. Never throws. */
export async function fetchReservationStatusClient(code: string): Promise<StatusFetchResult> {
  try {
    const res = await fetch(`/api/reservas/${encodeURIComponent(code)}`, { cache: 'no-store' });
    const json: unknown = await res.json().catch(() => null);
    const body = (json ?? {}) as Partial<TrackedReservation> & Partial<ReservationApiError>;
    if (!res.ok || body.error) {
      return {
        ok: false,
        status: res.status,
        error: typeof body.error === 'string' ? body.error : 'Ocurrió un error. Intenta de nuevo.',
        code: typeof body.code === 'string' ? body.code : null,
      };
    }
    return { ok: true, data: body as TrackedReservation };
  } catch {
    return { ok: false, status: 0, error: NETWORK_ERROR, code: 'NETWORK' };
  }
}
