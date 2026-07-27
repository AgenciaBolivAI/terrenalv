'use client';

// Device-session persistence for GUEST buyers (no accounts): the QR payment flow
// forces them out of the browser (bank app → screenshot → back), and mobile
// browsers routinely kill the tab in between. Everything here is SSR-safe,
// versioned, and fails silent (private mode / storage disabled).

const NS = 'terrenalv:v1';

function read<T>(storage: 'local' | 'session', key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = (storage === 'local' ? window.localStorage : window.sessionStorage).getItem(
      `${NS}:${key}`,
    );
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(storage: 'local' | 'session', key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    const store = storage === 'local' ? window.localStorage : window.sessionStorage;
    if (value === null) store.removeItem(`${NS}:${key}`);
    else store.setItem(`${NS}:${key}`, JSON.stringify(value));
  } catch {
    // Storage full or blocked — degrade silently.
  }
}

// ---------------------------------------------------------------------------
// Active reservation pointer: lets the buyer find their reservation from any
// page on this device, even if they lost the WhatsApp link.
// ---------------------------------------------------------------------------
export interface StoredReservation {
  code: string;
  lotLabel: string; // "Manzana M-24 · Lote 5"
  status: string;
  savedAt: string;
}

export function saveActiveReservation(r: Omit<StoredReservation, 'savedAt'>): void {
  write('local', 'reserva', { ...r, savedAt: new Date().toISOString() });
}

export function getActiveReservation(): StoredReservation | null {
  return read<StoredReservation>('local', 'reserva');
}

export function updateActiveReservationStatus(code: string, status: string): void {
  const current = getActiveReservation();
  if (!current || current.code !== code) return;
  // Terminal dead-ends stop being "active"; a confirmed purchase stays findable.
  if (status === 'expirada' || status === 'cancelada') {
    write('local', 'reserva', null);
  } else {
    write('local', 'reserva', { ...current, status });
  }
}

export function clearActiveReservation(): void {
  write('local', 'reserva', null);
}

// ---------------------------------------------------------------------------
// Reserve-form draft: survives the tab being killed mid-flow.
// ---------------------------------------------------------------------------
export interface ReserveFormDraft {
  full_name?: string;
  ci?: string;
  phone?: string;
  email?: string;
}

export function saveFormDraft(draft: ReserveFormDraft): void {
  write('local', 'form-draft', draft);
}

export function getFormDraft(): ReserveFormDraft | null {
  return read<ReserveFormDraft>('local', 'form-draft');
}

export function clearFormDraft(): void {
  write('local', 'form-draft', null);
}

// ---------------------------------------------------------------------------
// Map view state (per tab): come back to the same spot after visiting a lot page.
// ---------------------------------------------------------------------------
export interface StoredMapView {
  scale: number;
  positionX: number;
  positionY: number;
  selectedLotId: string | null;
}

export function saveMapView(v: StoredMapView): void {
  write('session', 'map-view', v);
}

export function getMapView(): StoredMapView | null {
  return read<StoredMapView>('session', 'map-view');
}
