import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { rpcErrorCode, rpcErrorCopy } from '@/lib/errors';
import { trackingCodeSchema } from '@/lib/validation';
import type { ReservationStatusPayload } from '@/lib/db-types';
import type { TrackedReservation } from '../lib/api';
import { mintQrSignedUrl } from './qr';

export type ReservationStatusResult =
  | { ok: true; data: TrackedReservation }
  | { ok: false; status: number; error: string; code: string | null };

export const SERVICE_UNAVAILABLE = 'Servicio no disponible todavía';

/**
 * Shared server-side status lookup: used by GET /api/reservas/[code] AND the
 * /reserva/[code] RSC page (the page never fetches its own HTTP endpoint).
 * Attaches a 2 h signed URL for the bank QR when the reservation is payable.
 */
export async function fetchReservationStatus(
  rawCode: string,
  ipHash: string | null,
): Promise<ReservationStatusResult> {
  const parsed = trackingCodeSchema.safeParse(rawCode);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: 'Código inválido (ej: EDS-7F3K-9Q2M)',
      code: 'INVALID_CODE',
    };
  }

  let admin: SupabaseClient;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, status: 503, error: SERVICE_UNAVAILABLE, code: 'SERVICE_UNAVAILABLE' };
  }

  try {
    const { data, error } = await admin.rpc('get_reservation_status', {
      p_tracking_code: parsed.data,
      p_ip_hash: ipHash,
    });
    if (error) {
      const code = rpcErrorCode(error.message);
      const status = code === 'RESERVATION_NOT_FOUND' ? 404 : code === 'RATE_LIMITED' ? 429 : 500;
      return { ok: false, status, error: rpcErrorCopy(error.message), code };
    }
    if (!data) {
      return {
        ok: false,
        status: 404,
        error: rpcErrorCopy('RESERVATION_NOT_FOUND'),
        code: 'RESERVATION_NOT_FOUND',
      };
    }

    const payload = data as ReservationStatusPayload;
    let qr_url: string | null = null;
    if (
      (payload.status === 'pendiente_pago' || payload.status === 'rechazo_reintento') &&
      payload.payment_instructions?.qr_image_path
    ) {
      qr_url = await mintQrSignedUrl(admin, payload.payment_instructions);
    }
    return { ok: true, data: { ...payload, qr_url } };
  } catch {
    // Network / DB unreachable (project not provisioned yet).
    return { ok: false, status: 503, error: SERVICE_UNAVAILABLE, code: 'SERVICE_UNAVAILABLE' };
  }
}
