// America/La_Paz boundary helpers. Bolivia is fixed UTC-4 with no DST, so
// boundaries are computed arithmetically: 00:00 La_Paz === 04:00 UTC.

const OFFSET_MS = 4 * 3_600_000;

function laPazParts(d: Date): { y: number; m: number; d: number } {
  const shifted = new Date(d.getTime() - OFFSET_MS);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth(), d: shifted.getUTCDate() };
}

/** 00:00 of the given instant's La_Paz calendar day, as ISO UTC. */
export function laPazDayStartIso(now: Date = new Date()): string {
  const p = laPazParts(now);
  return new Date(Date.UTC(p.y, p.m, p.d, 4, 0, 0)).toISOString();
}

/** 00:00 of the NEXT La_Paz day (exclusive upper bound). */
export function laPazDayEndIso(now: Date = new Date()): string {
  const p = laPazParts(now);
  return new Date(Date.UTC(p.y, p.m, p.d + 1, 4, 0, 0)).toISOString();
}

/** First instant of the current La_Paz month. */
export function laPazMonthStartIso(now: Date = new Date()): string {
  const p = laPazParts(now);
  return new Date(Date.UTC(p.y, p.m, 1, 4, 0, 0)).toISOString();
}

/** First instant of the NEXT La_Paz month (exclusive upper bound). */
export function laPazMonthEndIso(now: Date = new Date()): string {
  const p = laPazParts(now);
  return new Date(Date.UTC(p.y, p.m + 1, 1, 4, 0, 0)).toISOString();
}

/** Start of a La_Paz calendar date given as 'YYYY-MM-DD' (date input value). */
export function laPazDateToStartIso(ymd: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 4, 0, 0)).toISOString();
}

/** Exclusive end (next day 00:00 La_Paz) of a 'YYYY-MM-DD' date. */
export function laPazDateToEndIso(ymd: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1, 4, 0, 0)).toISOString();
}
