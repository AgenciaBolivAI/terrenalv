// GET /api/reservas/[code] — reservation status for the tracking page.
// The tracking code IS the capability; responses contain zero extra PII beyond
// what the RPC's sanitized projection exposes.

import { NextResponse } from 'next/server';
import { hashClientIp } from '@/lib/server/client-ip';
import { fetchReservationStatus } from '@/features/reservations/server/getStatus';
import { safeDecode } from '@/features/reservations/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  const { code } = await ctx.params;
  const result = await fetchReservationStatus(safeDecode(code), hashClientIp(request.headers));
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
  return NextResponse.json(result.data, {
    headers: { 'cache-control': 'no-store' },
  });
}
