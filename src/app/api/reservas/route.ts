// POST /api/reservas — create a guest reservation.
// Thin shim over the atomic create_reservation RPC (service role): validates,
// enforces CAPTCHA when enabled, supplies the real IP hash, and mints the
// short-lived signed URL for the bank QR image.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSetting } from '@/lib/server/settings';
import { hashClientIp } from '@/lib/server/client-ip';
import { rpcErrorCode, rpcErrorCopy } from '@/lib/errors';
import { reserveFormSchema } from '@/lib/validation';
import type { CreateReservationPayload } from '@/lib/db-types';
import { mintQrSignedUrl } from '@/features/reservations/server/qr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SERVICE_UNAVAILABLE = 'Servicio no disponible todavía';

async function verifyTurnstile(
  secret: string,
  token: string | undefined,
  headers: Headers,
): Promise<boolean> {
  if (!token) return false;
  try {
    const remoteip =
      headers.get('x-real-ip') ?? headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const body = new URLSearchParams({ secret, response: token });
    if (remoteip) body.set('remoteip', remoteip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida.', code: 'BAD_REQUEST' }, { status: 400 });
  }

  const parsed = reserveFormSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.', code: 'VALIDATION' },
      { status: 400 },
    );
  }
  const turnstileToken =
    raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).turnstileToken === 'string'
      ? ((raw as Record<string, unknown>).turnstileToken as string)
      : undefined;

  let admin: SupabaseClient;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: SERVICE_UNAVAILABLE, code: 'SERVICE_UNAVAILABLE' }, { status: 503 });
  }

  try {
    // Resolve the lot's project (settings are project-scoped).
    const { data: lotRow, error: lotError } = await admin
      .from('lots')
      .select('project_id')
      .eq('id', parsed.data.lot_id)
      .is('deleted_at', null)
      .maybeSingle();
    if (lotError) {
      return NextResponse.json(
        { error: SERVICE_UNAVAILABLE, code: 'SERVICE_UNAVAILABLE' },
        { status: 503 },
      );
    }
    if (!lotRow) {
      return NextResponse.json(
        { error: rpcErrorCopy('LOT_NOT_AVAILABLE'), code: 'LOT_NOT_AVAILABLE' },
        { status: 400 },
      );
    }
    const projectId = lotRow.project_id as string;

    // CAPTCHA: only when the setting is on AND the secret is configured.
    const captchaEnabled = await getSetting<boolean>(admin, projectId, 'captcha_enabled', false);
    const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
    if (captchaEnabled === true && turnstileSecret) {
      const passed = await verifyTurnstile(turnstileSecret, turnstileToken, request.headers);
      if (!passed) {
        return NextResponse.json(
          { error: rpcErrorCopy('CAPTCHA_FAILED'), code: 'CAPTCHA_FAILED' },
          { status: 400 },
        );
      }
    }

    const termsVersion = await getSetting<string | null>(admin, projectId, 'terms_version', null);
    const ipHash = hashClientIp(request.headers);
    const userAgent = request.headers.get('user-agent');

    const { data, error } = await admin.rpc('create_reservation', {
      p_lot_id: parsed.data.lot_id,
      p_full_name: parsed.data.full_name,
      p_ci: parsed.data.ci,
      p_phone: parsed.data.phone,
      p_email: parsed.data.email ?? null,
      p_terms_version: termsVersion,
      p_ip_hash: ipHash,
      p_user_agent: userAgent,
    });
    if (error) {
      const code = rpcErrorCode(error.message);
      return NextResponse.json(
        { error: rpcErrorCopy(error.message), code },
        { status: code === 'RATE_LIMITED' ? 429 : 400 },
      );
    }

    const payload = data as CreateReservationPayload;
    const qr_url = await mintQrSignedUrl(admin, payload.payment_instructions);
    return NextResponse.json({ ...payload, qr_url });
  } catch {
    return NextResponse.json({ error: rpcErrorCopy(null), code: null }, { status: 500 });
  }
}
