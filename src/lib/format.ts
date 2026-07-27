// All user-facing dates/amounts go through here. Bolivia is America/La_Paz
// (UTC-4, no DST) — never format with the device default on server-rendered
// output, and never compute countdowns from the device clock (use serverNow).

const TZ = 'America/La_Paz';
const LOCALE = 'es-BO';

export function formatDateTime(iso: string | Date): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(typeof iso === 'string' ? new Date(iso) : iso);
}

export function formatDate(iso: string | Date): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TZ,
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(typeof iso === 'string' ? new Date(iso) : iso);
}

export function formatMoney(amount: number, currency: 'USD' | 'BOB'): string {
  const formatted = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return currency === 'BOB' ? `Bs ${formatted}` : `$us ${formatted}`;
}

export function formatArea(m2: number): string {
  return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 }).format(m2)} m²`;
}

/**
 * Countdown parts against SERVER time: callers capture (serverNow, targetIso) once
 * and tick locally from the offset — a skewed phone clock can't lie to the buyer.
 */
export function countdownFrom(
  targetIso: string,
  serverNowIso: string,
  clientCapturedAtMs: number,
): { totalMs: number; hours: number; minutes: number; seconds: number; expired: boolean } {
  const serverNow = new Date(serverNowIso).getTime();
  const elapsed = Date.now() - clientCapturedAtMs;
  const remaining = new Date(targetIso).getTime() - (serverNow + elapsed);
  const totalMs = Math.max(0, remaining);
  return {
    totalMs,
    hours: Math.floor(totalMs / 3_600_000),
    minutes: Math.floor((totalMs % 3_600_000) / 60_000),
    seconds: Math.floor((totalMs % 60_000) / 1000),
    expired: remaining <= 0,
  };
}

/** wa.me deep link with prefilled Spanish text. Phone must be E.164 without '+'. */
export function waLink(phoneE164: string, text: string): string {
  return `https://wa.me/${phoneE164.replace(/^\+/, '')}?text=${encodeURIComponent(text)}`;
}
