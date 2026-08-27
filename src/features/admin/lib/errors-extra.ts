// Team-RPC error codes that only surface in the admin panel — layered on top of
// the buyer-facing table in src/lib/errors.ts.

import { rpcErrorCopy } from '@/lib/errors';

const ADMIN_ERROR_COPY: Record<string, string> = {
  PERMISO_SOLO_LECTURA:
    'Tu acceso a esta sección es de solo lectura: podés mirar, pero no cambiar nada. Pedí al administrador que te habilite la edición.',
  PLAZO_NO_AMORTIZA:
    'Con ese interés y ese plazo la cuota apenas cubre el interés del mes: la deuda nunca bajaría. Acortá el plazo o bajá la tasa.',
  ADMIN_NO_SE_RESTRINGE:
    'Un administrador siempre puede todo. Si querés restringir a esta persona, cambiale primero el rol.',
  PAYMENT_NOT_REVIEWABLE: 'Este comprobante ya fue revisado por otra persona. Actualiza la lista.',
  RESERVATION_NOT_IN_REVIEW: 'La reserva ya no está en verificación. Actualiza la lista.',
  NOTE_REQUIRED: 'La nota es obligatoria para esta acción.',
  ABONO_CON_CUOTA_DEL_MES:
    'Primero la cuota del mes: no se abona a capital debiendo la cuota corriente ni las vencidas. Cobrala y después amortizá.',
  INVALID_HOURS: 'Cantidad de horas inválida (entre 1 y 720).',
  RESERVATION_NOT_CONFIRMED: 'La reserva no está confirmada; no hay venta que revertir.',
  RESERVATION_NOT_REINSTATABLE: 'Solo se pueden reactivar reservas expiradas o canceladas.',
  MANZANA_NOT_FOUND: 'No se encontró la manzana.',
  CATEGORY_NOT_FOUND: 'No se encontró la categoría de precios.',
  INVALID_OP: 'Operación de precios inválida.',
  PROFILE_NOT_FOUND: 'No se encontró el perfil.',
  MANZANA_HAS_NO_GEOMETRY: 'La manzana no tiene geometría dibujada.',
  // admin_reserve_offline
  BUYER_NAME_REQUIRED: 'Falta el nombre completo del comprador.',
  BUYER_CI_REQUIRED: 'Falta el carnet del comprador.',
  BUYER_PHONE_REQUIRED: 'Falta el celular del comprador.',
  INVALID_HOLD_HOURS: 'El plazo debe estar entre 1 y 720 horas.',
  // Postgres cuando la función todavía no está creada en la base.
  'Could not find the function': 'Falta aplicar la migración admin_reserve_offline en la base de datos.',
  PGRST202: 'Falta aplicar la migración admin_reserve_offline en la base de datos.',
};

/** Spanish copy for any RPC error seen from the admin panel. */
export function adminErrorCopy(message: string | undefined | null): string {
  if (message) {
    const extra = Object.keys(ADMIN_ERROR_COPY).find((code) => message.includes(code));
    if (extra) return ADMIN_ERROR_COPY[extra];
  }
  return rpcErrorCopy(message);
}
