'use client';

// "You have a reservation in progress" — session continuity for guests. Reads
// the device's stored reservation and offers one-tap return to its tracking page.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getActiveReservation, type StoredReservation } from '@/lib/client/session-state';

const STATUS_COPY: Record<string, string> = {
  pendiente_pago: 'Pago pendiente — tu lote sigue reservado',
  en_verificacion: 'Comprobante en verificación',
  rechazo_reintento: 'Tu comprobante necesita corrección',
  confirmada: 'Reserva confirmada',
};

export function ActiveReservationBanner({ variant = 'card' }: { variant?: 'card' | 'floating' }) {
  const [res, setRes] = useState<StoredReservation | null>(null);

  useEffect(() => {
    setRes(getActiveReservation());
  }, []);

  if (!res) return null;
  const copy = STATUS_COPY[res.status] ?? 'Reserva en curso';

  if (variant === 'floating') {
    return (
      <Link
        href={`/reserva/${encodeURIComponent(res.code)}`}
        className="pointer-events-auto flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-xs font-semibold text-white shadow-lg active:bg-emerald-800"
      >
        <span className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-300" />
        <span className="truncate">
          {copy} · {res.lotLabel || res.code}
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={`/reserva/${encodeURIComponent(res.code)}`}
      className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-left shadow-sm transition hover:bg-amber-100"
    >
      <div className="min-w-0">
        <p className="text-sm font-bold text-stone-800">{copy}</p>
        <p className="truncate text-xs text-stone-600">
          {res.lotLabel || 'Tu reserva'} · Código {res.code}
        </p>
      </div>
      <span className="shrink-0 rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-white">
        Ver estado
      </span>
    </Link>
  );
}
