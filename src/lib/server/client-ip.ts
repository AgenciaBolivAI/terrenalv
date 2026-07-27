import 'server-only';

import { createHash } from 'node:crypto';

/**
 * Hash the real client IP for rate limiting. We never store raw IPs.
 * Vercel sets x-real-ip / x-forwarded-for on every request.
 */
export function hashClientIp(headers: Headers): string | null {
  const ip =
    headers.get('x-real-ip') ??
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null;
  if (!ip) return null;
  const salt = process.env.IP_HASH_SALT ?? 'terrenalv';
  return createHash('sha256').update(`${ip}|${salt}`).digest('hex').slice(0, 32);
}
