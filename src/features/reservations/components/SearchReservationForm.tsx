'use client';

// "Buscar mi reserva": tracking-code input → /reserva/[code].
// Accepts a pasted full URL or a loosely formatted code and extracts the code.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { trackingCodeSchema } from '@/lib/validation';
import { getActiveReservation } from '@/lib/client/session-state';
import { ActiveReservationBanner } from './ActiveReservationBanner';

const CODE_IN_TEXT = /[A-Z]{2,5}-[0-9A-Z]{4}-[0-9A-Z]{4}/;

export function SearchReservationForm() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Session continuity: prefill the code stored on this device.
  useEffect(() => {
    const stored = getActiveReservation();
    if (stored) setValue((v) => v || stored.code);
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const raw = value.trim().toUpperCase();
    const extracted = raw.match(CODE_IN_TEXT)?.[0] ?? raw;
    const parsed = trackingCodeSchema.safeParse(extracted);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Código inválido (ej: EDS-7F3K-9Q2M)');
      return;
    }
    setError(null);
    setBusy(true);
    router.push(`/reserva/${encodeURIComponent(parsed.data)}`);
  }

  return (
    <div className="space-y-4">
      <ActiveReservationBanner />
      <form onSubmit={submit} noValidate className="space-y-3">
      <label htmlFor="track-code" className="block text-sm font-semibold text-stone-700">
        Código de seguimiento
      </label>
      <input
        id="track-code"
        autoComplete="off"
        autoCapitalize="characters"
        value={value}
        onChange={(e) => setValue(e.target.value.toUpperCase())}
        placeholder="EDS-7F3K-9Q2M"
        className="w-full rounded-xl border border-stone-300 bg-white px-3 py-3.5 font-mono text-lg font-bold tracking-wide text-stone-900 outline-none placeholder:font-sans placeholder:text-base placeholder:font-normal placeholder:text-stone-400 focus:border-brand-light focus:ring-2 focus:ring-green-100"
      />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-xl bg-brand px-4 py-3.5 text-base font-bold text-white active:bg-brand-light disabled:opacity-60"
      >
        {busy ? 'Buscando…' : 'Ver mi reserva'}
      </button>
      <p className="text-center text-xs text-stone-500">
        Lo recibiste al reservar tu lote. También puedes pegar el enlace completo.
      </p>
      </form>
    </div>
  );
}
