import type { PaymentStatus, RejectionReason, ReservationStatus } from '@/lib/db-types';

export interface QueuePayment {
  id: string;
  reference_code: string;
  purpose: string;
  amount: number;
  currency: 'USD' | 'BOB';
  amount_bob: number;
  status: PaymentStatus;
  proof_storage_path: string | null;
  proof_sha256: string | null;
  proof_submitted_at: string | null;
  rejection_reason: RejectionReason | null;
  rejection_note: string | null;
  created_at: string;
  provider: string;
  verified_at: string | null;
}

export interface QueueRow {
  id: string;
  tracking_code: string;
  buyer_full_name: string;
  buyer_ci: string;
  buyer_phone: string;
  buyer_email: string | null;
  status: ReservationStatus;
  hold_expires_at: string | null;
  retry_expires_at: string | null;
  price_agreed: number;
  currency: 'USD' | 'BOB';
  amount_due: number;
  amount_due_currency: 'USD' | 'BOB';
  source: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  lot: { id: string; number: string; manzana: { id: string; code: string } | null } | null;
  payments: QueuePayment[];
}

/**
 * NOTE: lots must be joined through the explicit FK — reservations↔lots has TWO
 * relationships (reservations.lot_id and lots.active_reservation_id) and
 * PostgREST refuses ambiguous embeds.
 */
export const QUEUE_SELECT =
  'id, tracking_code, buyer_full_name, buyer_ci, buyer_phone, buyer_email, status, ' +
  'hold_expires_at, retry_expires_at, price_agreed, currency, amount_due, amount_due_currency, ' +
  'source, confirmed_at, cancelled_at, cancel_reason, created_at, ' +
  'lot:lots!reservations_lot_id_fkey(id, number, manzana:manzanas(id, code)), ' +
  'payments(id, reference_code, purpose, amount, currency, amount_bob, status, proof_storage_path, ' +
  'proof_sha256, proof_submitted_at, rejection_reason, rejection_note, created_at, provider, verified_at)';

/** Latest 'reserva' payment (the reviewable one). */
export function reservePayment(row: QueueRow): QueuePayment | null {
  const pays = (row.payments ?? []).filter((p) => p.purpose === 'reserva');
  if (pays.length === 0) return null;
  return [...pays].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

export type TabId = 'revisar' | 'espera' | 'reintento' | 'confirmadas' | 'finalizadas';

export const TABS: { id: TabId; label: string; short: string; statuses: ReservationStatus[] }[] = [
  { id: 'revisar', label: 'Por revisar', short: 'Revisar', statuses: ['en_verificacion'] },
  { id: 'espera', label: 'En espera', short: 'Espera', statuses: ['pendiente_pago'] },
  { id: 'reintento', label: 'Reintento', short: 'Reintento', statuses: ['rechazo_reintento'] },
  { id: 'confirmadas', label: 'Confirmadas', short: 'Confirm.', statuses: ['confirmada'] },
  {
    id: 'finalizadas',
    label: 'Expiradas / Canceladas',
    short: 'Finalizadas',
    statuses: ['expirada', 'cancelada'],
  },
];

export function tabForStatus(status: ReservationStatus): TabId {
  const tab = TABS.find((t) => t.statuses.includes(status));
  return tab?.id ?? 'finalizadas';
}
