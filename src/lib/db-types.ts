// Pragmatic domain types mirroring the Supabase schema (hand-maintained until the
// generated types replace them once the project is provisioned; keep field names
// EXACTLY in sync with supabase/migrations).

export type LotStatus = 'disponible' | 'reservado' | 'vendido' | 'no_disponible';

export type ReservationStatus =
  | 'pendiente_pago'
  | 'en_verificacion'
  | 'confirmada'
  | 'rechazo_reintento'
  | 'expirada'
  | 'cancelada';

export type PaymentStatus =
  | 'pendiente'
  | 'comprobante_subido'
  | 'aprobado'
  | 'rechazado'
  | 'cancelado';

export type PaymentProviderKind = 'manual_qr' | 'banco_ganadero' | 'bnb';
// 'contabilidad' cobra cuotas, carga egresos y emite recibos, pero no invita
// gente ni cambia precios ni la configuracion del proyecto.
export type TeamRole = 'admin' | 'ventas' | 'contabilidad';
export type ManzanaKind = 'residencial' | 'area_verde' | 'equipamiento' | 'amenidad';
export type ElementKind =
  | 'calle'
  | 'avenida'
  | 'ciclovia'
  | 'area_verde'
  | 'equipamiento'
  | 'amenidad'
  | 'perimetro'
  | 'texto';
export type RejectionReason =
  | 'monto_incorrecto'
  | 'comprobante_ilegible'
  | 'pago_no_encontrado'
  | 'comprobante_duplicado'
  | 'otro';
export type NotificationType =
  | 'nueva_reserva'
  | 'comprobante_subido'
  | 'comprobante_tras_expiracion'
  | 'reserva_por_expirar'
  | 'reserva_expirada'
  | 'pago_aprobado'
  | 'pago_rechazado'
  | 'reserva_cancelada'
  | 'sistema';

export interface Project {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  location_text: string | null;
  status: 'activo' | 'borrador' | 'archivado';
  currency: 'USD' | 'BOB';
  tracking_prefix: string;
  geometry_version: number;
  status_rev: number;
}

export interface PricingCategory {
  id: string;
  project_id: string;
  code: string;
  name: string | null;
  color_hex: string;
  price_per_m2: number;
  sort_order: number;
}

export interface Profile {
  id: string;
  full_name: string;
  role: TeamRole;
  phone: string | null;
  is_active: boolean;
}

export interface ReservationRow {
  id: string;
  project_id: string;
  lot_id: string;
  tracking_code: string;
  buyer_full_name: string;
  buyer_ci: string;
  buyer_phone: string;
  buyer_email: string | null;
  status: ReservationStatus;
  hold_expires_at: string | null;
  retry_expires_at: string | null;
  price_agreed: number;
  amount_due: number;
  amount_due_currency: 'USD' | 'BOB';
  currency: 'USD' | 'BOB';
  source: 'web' | 'oficina';
  confirmed_at: string | null;
  created_at: string;
}

export interface PaymentRow {
  id: string;
  project_id: string;
  reservation_id: string;
  provider: PaymentProviderKind;
  reference_code: string;
  amount: number;
  currency: 'USD' | 'BOB';
  amount_bob: number;
  exchange_rate_used: number;
  status: PaymentStatus;
  proof_storage_path: string | null;
  proof_sha256: string | null;
  proof_submitted_at: string | null;
  rejection_reason: RejectionReason | null;
  rejection_note: string | null;
  created_at: string;
}

export interface NotificationRow {
  id: string;
  project_id: string;
  type: NotificationType;
  priority: 'alta' | 'normal' | 'baja';
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

/** Payment instructions stored in settings.payment_instructions. */
export interface PaymentInstructionsSetting {
  bank_name: string;
  account_holder: string;
  account_masked: string;
  qr_image_path: string | null;
  note: string;
}

/** Return shape of public.create_reservation / get_reservation_status. */
export interface ReservationStatusPayload {
  tracking_code: string;
  status: ReservationStatus;
  server_now: string;
  hold_expires_at: string | null;
  retry_expires_at: string | null;
  grace_minutes: number;
  buyer_display: string;
  manzana: string;
  lote: string;
  sector: string | null;
  area_m2: number;
  frontage_m: number | null;
  depth_m: number | null;
  price_agreed: number;
  currency: 'USD' | 'BOB';
  amount_due: number;
  amount_due_currency: 'USD' | 'BOB';
  confirmed_at: string | null;
  cancel_reason: string | null;
  payment: {
    status: PaymentStatus;
    reference_code: string;
    amount: number;
    currency: 'USD' | 'BOB';
    amount_bob: number;
    rejection_reason: RejectionReason | null;
    rejection_note: string | null;
    proof_submitted_at: string | null;
  } | null;
  payment_instructions: PaymentInstructionsSetting | null;
}

export interface CreateReservationPayload {
  tracking_code: string;
  reservation_id: string;
  hold_expires_at: string;
  server_now: string;
  price_agreed: number;
  currency: 'USD' | 'BOB';
  amount_due: number;
  amount_due_currency: 'USD' | 'BOB';
  amount_bob: number;
  exchange_rate: number;
  reference_code: string;
  payment_instructions: PaymentInstructionsSetting | null;
}
