'use client';

// Buyer self-cancel: link at the bottom of the tracking page → confirmation
// dialog that asks for the CI (the tracking link alone must not cancel).

import { useState } from 'react';
import { ciSchema } from '@/lib/validation';

export function CancelReservation({
  code,
  onCancelled,
}: {
  code: string;
  onCancelled: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [ci, setCi] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const parsed = ciSchema.safeParse(ci);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Carnet inválido.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/reservas/${encodeURIComponent(code)}/cancelar`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ci: parsed.data }),
      });
      const json: { error?: string } | null = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? 'No pudimos cancelar. Intenta de nuevo.');
        return;
      }
      setOpen(false);
      onCancelled();
    } catch {
      setError('Sin conexión. Intenta de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mt-8 text-center">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setError(null);
          }}
          className="text-sm text-stone-500 underline underline-offset-2 active:text-stone-700"
        >
          ¿Ya no quieres el lote? Cancelar mi reserva
        </button>
      </div>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Cancelar reserva"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-lg font-bold text-stone-900">Cancelar tu reserva</h3>
            <p className="mt-1 text-sm text-stone-600">
              El lote volverá a estar disponible para otras personas. Esta acción no se puede
              deshacer.
            </p>
            <label className="mt-4 block text-sm font-semibold text-stone-700" htmlFor="cancel-ci">
              Confirma tu carnet de identidad
            </label>
            <input
              id="cancel-ci"
              inputMode="text"
              autoComplete="off"
              value={ci}
              onChange={(e) => setCi(e.target.value)}
              placeholder="7896541"
              className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-3 text-base outline-none focus:border-brand-light focus:ring-2 focus:ring-green-100"
            />
            {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded-xl border border-stone-300 px-4 py-3 text-sm font-bold text-stone-700 active:bg-stone-100"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy}
                className="rounded-xl bg-red-600 px-4 py-3 text-sm font-bold text-white active:bg-red-700 disabled:opacity-60"
              >
                {busy ? 'Cancelando…' : 'Sí, cancelar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
