// Spanish labels + badge styles for domain enums (admin panel).

import type {
  LotStatus,
  PaymentStatus,
  RejectionReason,
  ReservationStatus,
} from '@/lib/db-types';

export const RESERVATION_STATUS_LABEL: Record<ReservationStatus, string> = {
  pendiente_pago: 'Esperando pago',
  en_verificacion: 'En verificación',
  confirmada: 'Confirmada',
  rechazo_reintento: 'Reintento',
  expirada: 'Expirada',
  cancelada: 'Cancelada',
};

export const RESERVATION_STATUS_BADGE: Record<ReservationStatus, string> = {
  pendiente_pago: 'bg-amber-100 text-amber-800',
  en_verificacion: 'bg-sky-100 text-sky-800',
  confirmada: 'bg-green-100 text-green-800',
  rechazo_reintento: 'bg-orange-100 text-orange-800',
  expirada: 'bg-stone-200 text-stone-600',
  cancelada: 'bg-red-100 text-red-700',
};

export const LOT_STATUS_LABEL: Record<LotStatus, string> = {
  disponible: 'Disponible',
  reservado: 'Reservado',
  vendido: 'Vendido',
  no_disponible: 'Bloqueado',
};

export const LOT_STATUS_BADGE: Record<LotStatus, string> = {
  disponible: 'bg-green-100 text-green-800',
  reservado: 'bg-orange-100 text-orange-800',
  vendido: 'bg-stone-200 text-stone-600',
  no_disponible: 'bg-stone-100 text-stone-500',
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pendiente: 'Pendiente',
  comprobante_subido: 'Comprobante subido',
  aprobado: 'Aprobado',
  rechazado: 'Rechazado',
  cancelado: 'Cancelado',
};

export const REJECTION_REASON_LABEL: Record<RejectionReason, string> = {
  monto_incorrecto: 'Monto incorrecto',
  comprobante_ilegible: 'Comprobante ilegible',
  pago_no_encontrado: 'Pago no encontrado en la cuenta',
  comprobante_duplicado: 'Comprobante duplicado',
  otro: 'Otro motivo',
};
