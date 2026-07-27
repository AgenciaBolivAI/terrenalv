import { NextResponse, type NextRequest } from 'next/server';
import { createElement, type ReactElement } from 'react';
import { timingSafeEqual } from 'node:crypto';
import { Resend } from 'resend';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSetting } from '@/lib/server/settings';
import { formatDateTime } from '@/lib/format';
import TeamNuevaReserva from '../../../../../emails/TeamNuevaReserva';
import TeamComprobanteSubido from '../../../../../emails/TeamComprobanteSubido';
import BuyerReservaCreada from '../../../../../emails/BuyerReservaCreada';
import BuyerReservaConfirmada from '../../../../../emails/BuyerReservaConfirmada';
import BuyerComprobanteRechazado from '../../../../../emails/BuyerComprobanteRechazado';
import BuyerReservaExpirada from '../../../../../emails/BuyerReservaExpirada';
import GenericNotification from '../../../../../emails/GenericNotification';

export const runtime = 'nodejs';

interface OutboxRow {
  id: string;
  notification_id: string | null;
  channel: string;
  recipient: string;
  template: string;
  payload: Record<string, unknown>;
  attempts: number;
}

interface NotifRow {
  id: string;
  entity_type: string | null;
  entity_id: string | null;
  title: string;
  body: string | null;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  try {
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

interface ReservationLookup {
  manzana: string | null;
  lote: string | null;
  reference_code: string | null;
  monto_bob: number | null;
  vencimiento: string | null;
}

async function lookupReservation(
  admin: SupabaseClient,
  trackingCode: string,
): Promise<ReservationLookup | null> {
  const { data } = await admin
    .from('reservations')
    .select(
      'tracking_code, hold_expires_at, lot:lots!reservations_lot_id_fkey(number, manzana:manzanas(code)), payments(reference_code, amount_bob, purpose, created_at)',
    )
    .eq('tracking_code', trackingCode)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as {
    hold_expires_at: string | null;
    lot: { number: string; manzana: { code: string } | null } | null;
    payments: { reference_code: string; amount_bob: number; purpose: string; created_at: string }[];
  };
  const pay = (row.payments ?? [])
    .filter((p) => p.purpose === 'reserva')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return {
    manzana: row.lot?.manzana?.code ?? null,
    lote: row.lot?.number ?? null,
    reference_code: pay?.reference_code ?? null,
    monto_bob: pay ? Number(pay.amount_bob) : null,
    vencimiento: row.hold_expires_at ? formatDateTime(row.hold_expires_at) : null,
  };
}

function humanizeTemplate(template: string): string {
  return template.replace(/^(team_|buyer_)/, '').replace(/_/g, ' ');
}

async function buildEmail(
  admin: SupabaseClient,
  row: OutboxRow,
  notif: NotifRow | null,
  base: string | null,
): Promise<{ subject: string; react: ReactElement }> {
  const p = row.payload ?? {};
  const code = typeof p.tracking_code === 'string' ? p.tracking_code : '—';
  const trackingUrl = base && code !== '—' ? `${base}/reserva/${code}` : null;
  const adminUrl =
    base && notif?.entity_type === 'reservation' && notif.entity_id
      ? `${base}/admin/reservas?open=${notif.entity_id}`
      : base
        ? `${base}/admin/reservas`
        : null;

  switch (row.template) {
    case 'team_nueva_reserva':
      return {
        subject: `Nueva reserva ${code} — Lote ${p.lote ?? '—'}, Mz ${p.manzana ?? '—'}`,
        react: createElement(TeamNuevaReserva, {
          tracking_code: code,
          manzana: (p.manzana as string) ?? '—',
          lote: (p.lote as string) ?? '—',
          monto_bob: (p.monto_bob as number) ?? undefined,
          adminUrl,
        }),
      };
    case 'team_comprobante_subido':
      return {
        subject: `Comprobante subido — ${code}`,
        react: createElement(TeamComprobanteSubido, {
          tracking_code: code,
          manzana: (p.manzana as string) ?? '—',
          lote: (p.lote as string) ?? '—',
          monto_bob: (p.monto_bob as number) ?? undefined,
          posible_duplicado: p.posible_duplicado === true,
          reviewUrl: adminUrl,
        }),
      };
    case 'buyer_reserva_creada': {
      // The outbox payload lacks reference/vencimiento — enrich from the DB.
      const extra = code !== '—' ? await lookupReservation(admin, code) : null;
      return {
        subject: `Tu reserva ${code} — Estrellas del Sur`,
        react: createElement(BuyerReservaCreada, {
          tracking_code: code,
          manzana: (p.manzana as string) ?? extra?.manzana ?? '—',
          lote: (p.lote as string) ?? extra?.lote ?? '—',
          monto_bob: (p.monto_bob as number) ?? extra?.monto_bob ?? undefined,
          reference_code: extra?.reference_code ?? null,
          vencimiento: extra?.vencimiento ?? null,
          trackingUrl,
        }),
      };
    }
    case 'buyer_reserva_confirmada': {
      const extra = code !== '—' ? await lookupReservation(admin, code) : null;
      return {
        subject: `¡Pago confirmado! Reserva ${code} — Estrellas del Sur`,
        react: createElement(BuyerReservaConfirmada, {
          tracking_code: code,
          manzana: extra?.manzana ?? null,
          lote: extra?.lote ?? null,
          trackingUrl,
        }),
      };
    }
    case 'buyer_comprobante_rechazado':
      return {
        subject: `Revisa tu comprobante — reserva ${code}`,
        react: createElement(BuyerComprobanteRechazado, {
          tracking_code: code,
          motivo: (p.motivo as string) ?? null,
          permite_reintento: p.permite_reintento !== false,
          trackingUrl,
        }),
      };
    case 'buyer_reserva_expirada':
      return {
        subject: `Tu reserva ${code} expiró — Estrellas del Sur`,
        react: createElement(BuyerReservaExpirada, { tracking_code: code, trackingUrl }),
      };
    default:
      return {
        subject: notif?.title ?? `Notificación Terrenalv — ${humanizeTemplate(row.template)}`,
        react: createElement(GenericNotification, {
          title: notif?.title ?? `Notificación: ${humanizeTemplate(row.template)}`,
          bodyText: notif?.body ?? null,
          details: p,
        }),
      };
  }
}

/**
 * Outbox drain. Called by pg_cron (private.ping_outbox_delivery) with
 * `Authorization: Bearer <settings.internal_cron_secret>`. Idempotent-ish:
 * each row is attempted at most 3 times.
 */
export async function POST(req: NextRequest) {
  let admin: SupabaseClient;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: 'Supabase no configurado.' }, { status: 503 });
  }

  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const secret = await getSetting<string | null>(admin, null, 'internal_cron_secret', null);
  if (!secret || !token || !safeEqual(token, secret)) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }

  const { data: pending, error: qErr } = await admin
    .from('notification_outbox')
    .select('id, notification_id, channel, recipient, template, payload, attempts')
    .eq('status', 'pendiente')
    .lt('attempts', 3)
    .order('created_at', { ascending: true })
    .limit(20);
  if (qErr) {
    return NextResponse.json({ error: 'No se pudo leer la cola.' }, { status: 500 });
  }

  const rows = (pending ?? []) as OutboxRow[];
  if (rows.length === 0) {
    return NextResponse.json({ processed: 0, sent: 0, failed: 0 });
  }

  // Batch-fetch the parent notifications (deep links need entity_id).
  const notifIds = [...new Set(rows.map((r) => r.notification_id).filter(Boolean))] as string[];
  const notifMap = new Map<string, NotifRow>();
  if (notifIds.length > 0) {
    const { data: notifs } = await admin
      .from('notifications')
      .select('id, entity_type, entity_id, title, body')
      .in('id', notifIds);
    for (const n of (notifs ?? []) as NotifRow[]) notifMap.set(n.id, n);
  }

  const baseRaw = await getSetting<string | null>(admin, null, 'app_base_url', null);
  const base = typeof baseRaw === 'string' && baseRaw ? baseRaw.replace(/\/+$/, '') : null;

  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM ?? 'Terrenalv <onboarding@resend.dev>';
  const resend = resendKey ? new Resend(resendKey) : null;

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    const attempts = row.attempts + 1;

    if (!resend) {
      // Per contract: count the attempt, keep it pendiente.
      await admin
        .from('notification_outbox')
        .update({ attempts, last_error: 'RESEND_API_KEY no configurada' })
        .eq('id', row.id);
      failed += 1;
      continue;
    }

    if (row.channel !== 'email') {
      await admin
        .from('notification_outbox')
        .update({
          attempts,
          status: attempts >= 3 ? 'fallido' : 'pendiente',
          last_error: `Canal no soportado: ${row.channel}`,
        })
        .eq('id', row.id);
      failed += 1;
      continue;
    }

    try {
      const notif = row.notification_id ? (notifMap.get(row.notification_id) ?? null) : null;
      const { subject, react } = await buildEmail(admin, row, notif, base);
      const { error: sendErr } = await resend.emails.send({
        from,
        to: row.recipient,
        subject,
        react,
      });
      if (sendErr) throw new Error(sendErr.message ?? 'Error de Resend');

      await admin
        .from('notification_outbox')
        .update({
          status: 'enviado',
          sent_at: new Date().toISOString(),
          attempts,
          last_error: null,
        })
        .eq('id', row.id);
      sent += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 500) : 'Error desconocido';
      await admin
        .from('notification_outbox')
        .update({
          attempts,
          status: attempts >= 3 ? 'fallido' : 'pendiente',
          last_error: msg,
        })
        .eq('id', row.id);
      failed += 1;
    }
  }

  return NextResponse.json({ processed: rows.length, sent, failed });
}
