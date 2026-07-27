'use client';

// Sticky skew-proof countdown: ticks locally against the captured server clock
// (countdownFrom), so a wrong phone clock can't lie to the buyer.

import { useEffect, useReducer, useRef } from 'react';
import { countdownFrom } from '@/lib/format';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function CountdownBar({
  targetIso,
  serverNowIso,
  capturedAtMs,
  label,
  expiredHint,
  onExpired,
}: {
  targetIso: string;
  serverNowIso: string;
  capturedAtMs: number;
  /** e.g. "Tu reserva expira en" */
  label: string;
  /** Shown when the clock hits zero (grace-period reassurance). */
  expiredHint?: string;
  onExpired?: () => void;
}) {
  const [, tick] = useReducer((x: number) => x + 1, 0);
  // Keyed on the DEADLINE, not the snapshot: refetching produces a new
  // serverNowIso/capturedAtMs, and resetting on those looped onExpired →
  // refetch → onExpired, burning the buyer's IP rate limit right when they
  // needed to upload their proof during the grace window.
  const firedForRef = useRef<string | null>(null);

  useEffect(() => {
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetIso, serverNowIso, capturedAtMs]);

  const c = countdownFrom(targetIso, serverNowIso, capturedAtMs);

  useEffect(() => {
    if (c.expired && firedForRef.current !== targetIso) {
      firedForRef.current = targetIso;
      onExpired?.();
    }
  }, [c.expired, targetIso, onExpired]);

  if (c.expired) {
    return (
      <div className="sticky top-0 z-40 -mx-4 mb-4 bg-stone-800 px-4 py-3 text-center text-white shadow-md">
        <p className="text-sm font-bold">El tiempo terminó</p>
        {expiredHint ? <p className="mt-0.5 text-xs text-stone-300">{expiredHint}</p> : null}
      </div>
    );
  }

  const urgent = c.totalMs < 3_600_000;
  return (
    <div
      className={`sticky top-0 z-40 -mx-4 mb-4 px-4 py-2.5 text-center text-white shadow-md ${
        urgent ? 'bg-orange-700' : 'bg-brand'
      }`}
    >
      <p className="text-[11px] uppercase tracking-wide opacity-90">{label}</p>
      <p suppressHydrationWarning className="font-mono text-2xl font-bold tabular-nums leading-tight">
        {pad(c.hours)}:{pad(c.minutes)}:{pad(c.seconds)}
      </p>
    </div>
  );
}
