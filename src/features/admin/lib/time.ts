// Relative-time helpers for the admin feed and queues (es-BO copy).

/** 'hace 5 min', 'hace 3 h', 'hace 2 días'. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(iso).getTime();
  if (ms < 60_000) return 'hace un momento';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}

/** Elapsed duration since `iso`: '25 min', '3 h 20 min', '2 días 4 h'. */
export function sinceLabel(iso: string, now: Date = new Date()): string {
  const ms = Math.max(0, now.getTime() - new Date(iso).getTime());
  return durationLabel(ms);
}

/** Remaining until `iso` (negative → 'vencido'). */
export function untilLabel(iso: string, now: Date = new Date()): string {
  const ms = new Date(iso).getTime() - now.getTime();
  if (ms <= 0) return 'vencido';
  return durationLabel(ms);
}

export function durationLabel(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) {
    const rem = min % 60;
    return rem > 0 ? `${h} h ${rem} min` : `${h} h`;
  }
  const d = Math.floor(h / 24);
  const remH = h % 24;
  const dias = d === 1 ? '1 día' : `${d} días`;
  return remH > 0 ? `${dias} ${remH} h` : dias;
}
