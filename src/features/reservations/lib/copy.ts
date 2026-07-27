// Spanish (es-BO) copy tables for the tracking page.

import type { RejectionReason, ReservationStatus } from '@/lib/db-types';

export const STATUS_LABEL: Record<ReservationStatus, string> = {
  pendiente_pago: 'Pendiente de pago',
  en_verificacion: 'En verificación',
  confirmada: 'Confirmada',
  rechazo_reintento: 'Necesita nuevo comprobante',
  expirada: 'Expirada',
  cancelada: 'Cancelada',
};

export const STATUS_PILL_CLASS: Record<ReservationStatus, string> = {
  pendiente_pago: 'bg-amber-100 text-amber-800 border-amber-200',
  en_verificacion: 'bg-sky-100 text-sky-800 border-sky-200',
  confirmada: 'bg-green-100 text-green-800 border-green-200',
  rechazo_reintento: 'bg-orange-100 text-orange-800 border-orange-200',
  expirada: 'bg-stone-100 text-stone-600 border-stone-200',
  cancelada: 'bg-stone-100 text-stone-600 border-stone-200',
};

const REJECTION_COPY: Record<RejectionReason, string> = {
  monto_incorrecto: 'El monto transferido no coincide con el monto de la seña.',
  comprobante_ilegible: 'El comprobante no se puede leer con claridad.',
  pago_no_encontrado: 'No encontramos tu pago en la cuenta del banco.',
  comprobante_duplicado: 'Este comprobante ya fue usado en otra reserva.',
  otro: 'Hubo un problema con tu comprobante.',
};

export function rejectionCopy(reason: RejectionReason | null | undefined): string {
  return reason ? REJECTION_COPY[reason] : REJECTION_COPY.otro;
}
