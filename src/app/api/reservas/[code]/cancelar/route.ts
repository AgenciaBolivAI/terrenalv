// POST /api/reservas/[code]/cancelar — buyer self-cancel.
// Requires the CI to match: the forwardable tracking link alone must not be able
// to kill a reservation (enforced again inside the RPC).

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { hashClientIp } from '@/lib/server/client-ip';
import { rpcErrorCode, rpcErrorCopy } from '@/lib/errors';
import { ciSchema, trackingCodeSchema } from '@/lib/validation';
import { safeDecode } from '@/features/reservations/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await ctx.params;
  const parsedCode = trackingCodeSchema.safeParse(safeDecode(rawCode));
  if (!parsedCode.success) {
    return NextResponse.json(
      { error: 'Código inválido (ej: EDS-7F3K-9Q2M)', code: 'INVALID_CODE' },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida.', code: 'BAD_REQUEST' }, { status: 400 });
  }
  const rawCi =
    body && typeof body === 'object' && typeof (body as Record<string, unknown>).ci === 'string'
      ? ((body as Record<string, unknown>).ci as string)
      : '';
  const parsedCi = ciSchema.safeParse(rawCi);
  if (!parsedCi.success) {
    return NextResponse.json(
      { error: parsedCi.error.issues[0]?.message ?? 'Carnet inválido.', code: 'INVALID_CI' },
      { status: 400 },
    );
  }

  let admin: SupabaseClient;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: 'Servicio no disponible todavía', code: 'SERVICE_UNAVAILABLE' },
      { status: 503 },
    );
  }

  try {
    const { error } = await admin.rpc('cancel_reservation', {
      p_tracking_code: parsedCode.data,
      p_ci: parsedCi.data,
      p_ip_hash: hashClientIp(request.headers),
    });
    if (error) {
      const code = rpcErrorCode(error.message);
      const status =
        code === 'RESERVATION_NOT_FOUND'
          ? 404
          : code === 'RESERVATION_NOT_ACTIVE'
            ? 409
            : code === 'RATE_LIMITED'
              ? 429
              : 400;
      return NextResponse.json({ error: rpcErrorCopy(error.message), code }, { status });
    }
    return NextResponse.json({ status: 'cancelada' });
  } catch {
    return NextResponse.json(
      { error: 'Servicio no disponible todavía', code: 'SERVICE_UNAVAILABLE' },
      { status: 503 },
    );
  }
}
