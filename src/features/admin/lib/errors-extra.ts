// Team-RPC error codes that only surface in the admin panel — layered on top of
// the buyer-facing table in src/lib/errors.ts.

import { rpcErrorCopy } from '@/lib/errors';

const ADMIN_ERROR_COPY: Record<string, string> = {
  PAYMENT_NOT_REVIEWABLE: 'Este comprobante ya fue revisado por otra persona. Actualiza la lista.',
  RESERVATION_NOT_IN_REVIEW: 'La reserva ya no está en verificación. Actualiza la lista.',
  NOTE_REQUIRED: 'La nota es obligatoria para esta acción.',
  INVALID_HOURS: 'Cantidad de horas inválida (entre 1 y 720).',
  RESERVATION_NOT_CONFIRMED: 'La reserva no está confirmada; no hay venta que revertir.',
  RESERVATION_NOT_REINSTATABLE: 'Solo se pueden reactivar reservas expiradas o canceladas.',
  MANZANA_NOT_FOUND: 'No se encontró la manzana.',
  CATEGORY_NOT_FOUND: 'No se encontró la categoría de precios.',
  INVALID_OP: 'Operación de precios inválida.',
  PROFILE_NOT_FOUND: 'No se encontró el perfil.',
  MANZANA_HAS_NO_GEOMETRY: 'La manzana no tiene geometría dibujada.',
};

/** Spanish copy for any RPC error seen from the admin panel. */
export function adminErrorCopy(message: string | undefined | null): string {
  if (message) {
    const extra = Object.keys(ADMIN_ERROR_COPY).find((code) => message.includes(code));
    if (extra) return ADMIN_ERROR_COPY[extra];
  }
  return rpcErrorCopy(message);
}
