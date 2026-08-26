'use client';

// The tracking page body: renders the whole reservation lifecycle from the
// sanitized status payload. This is where money anxiety lives — every state
// says clearly what happened and what to do next.

import { useState } from 'react';
import Link from 'next/link';
import { LogoMark } from '@/components/Logo';
import { formatDateTime, formatMoney } from '@/lib/format';
import type { TrackedReservation } from '../lib/api';
import { useReservationStatus } from '../hooks/useReservationStatus';
import { STATUS_LABEL, STATUS_PILL_CLASS, rejectionCopy } from '../lib/copy';
import { CountdownBar } from './CountdownBar';
import { CopyButton } from './CopyButton';
import { LotSummaryCard } from './LotSummaryCard';
import { PaymentSection } from './PaymentSection';
import { ProofUploader } from './ProofUploader';
import { CancelReservation } from './CancelReservation';
import { MiPublicacion } from '@/features/market/MiPublicacion';
import { MiPlanDePago } from '@/features/payments/MiPlanDePago';

const MAP_URL = '/prados-del-sur/mapa';

function ShareButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    const url = `${window.location.origin}/reserva/${code}`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'Mi reserva — Prados del Sur',
          text: `Seguimiento de mi reserva ${code}`,
          url,
        });
        return;
      } catch {
        /* user cancelled — fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }
  return (
    <button
      type="button"
      onClick={() => void share()}
      className="w-full rounded-xl border border-brand px-4 py-3 text-sm font-bold text-brand active:bg-green-50"
    >
      {copied ? '¡Enlace copiado!' : 'Compartir enlace de seguimiento'}
    </button>
  );
}

function SummaryFromStatus({ data }: { data: TrackedReservation }) {
  return (
    <LotSummaryCard
      manzana={data.manzana}
      lote={data.lote}
      sector={data.sector}
      areaM2={data.area_m2}
      frontageM={data.frontage_m}
      depthM={data.depth_m}
      price={data.price_agreed}
      currency={data.currency}
      amountDue={data.amount_due}
      amountDueCurrency={data.amount_due_currency}
    />
  );
}

export function TrackingView({
  code,
  initial,
  nuevo,
}: {
  code: string;
  initial: TrackedReservation;
  nuevo: boolean;
}) {
  const { data, capturedAtMs, refetch, staleWarning } = useReservationStatus(code, initial);
  const status = data.status;
  const graceHint =
    data.grace_minutes > 0
      ? `Si ya pagaste, todavía puedes subir tu comprobante durante unos ${data.grace_minutes} minutos.`
      : undefined;

  return (
    // The page rail (max width, padding, branded header/footer) comes from PublicShell.
    <div>
      {status === 'pendiente_pago' && data.hold_expires_at ? (
        <CountdownBar
          targetIso={data.hold_expires_at}
          serverNowIso={data.server_now}
          capturedAtMs={capturedAtMs}
          label="Tu reserva expira en"
          expiredHint={graceHint}
          onExpired={() => void refetch()}
        />
      ) : null}
      {status === 'rechazo_reintento' && data.retry_expires_at ? (
        <CountdownBar
          targetIso={data.retry_expires_at}
          serverNowIso={data.server_now}
          capturedAtMs={capturedAtMs}
          label="Plazo para subir un nuevo comprobante"
          expiredHint={graceHint}
          onExpired={() => void refetch()}
        />
      ) : null}

      {nuevo && (status === 'pendiente_pago' || status === 'en_verificacion') ? (
        <div className="mt-3 rounded-2xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          <span className="font-bold">¡Tu reserva fue creada!</span> Guarda este enlace: aquí verás
          el estado de tu pago en todo momento.
        </div>
      ) : null}

      {/* Tracking code header — prominent in EVERY status */}
      <header className="pb-3 pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
          Código de seguimiento
        </p>
        <div className="mt-1 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate font-mono text-2xl font-extrabold tracking-tight text-stone-900">
            {data.tracking_code}
          </p>
          <CopyButton value={data.tracking_code} />
        </div>
        <span
          className={`mt-2 inline-block rounded-full border px-3 py-1 text-xs font-bold ${STATUS_PILL_CLASS[status]}`}
        >
          {STATUS_LABEL[status]}
        </span>
      </header>

      {staleWarning ? (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
          {staleWarning}
        </div>
      ) : null}

      {/* ---------------- pendiente_pago ---------------- */}
      {status === 'pendiente_pago' ? (
        <div className="space-y-4">
          <SummaryFromStatus data={data} />
          <PaymentSection data={data} />
          <ProofUploader code={data.tracking_code} onUploaded={() => void refetch()} />
          <p className="text-center text-xs text-stone-500">
            Guarda este enlace (puedes reenviártelo por WhatsApp). Lo necesitas para ver tu estado.
          </p>
          <CancelReservation code={data.tracking_code} onCancelled={() => void refetch()} />
        </div>
      ) : null}

      {/* ---------------- en_verificacion ---------------- */}
      {status === 'en_verificacion' ? (
        <div className="space-y-4">
          <section className="rounded-2xl border border-sky-200 bg-sky-50 p-5 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-sky-100">
              <svg viewBox="0 0 24 24" className="h-8 w-8 text-sky-700" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h2 className="text-xl font-extrabold text-stone-900">Estamos verificando tu pago</h2>
            {data.payment?.proof_submitted_at ? (
              <p className="mt-1 text-sm text-stone-600">
                Comprobante recibido el {formatDateTime(data.payment.proof_submitted_at)}
              </p>
            ) : null}
            <p className="mt-3 text-sm text-stone-600">
              Te avisaremos aquí mismo cuando esté confirmado. Guarda este enlace — no necesitas
              hacer nada más.
            </p>
          </section>
          <SummaryFromStatus data={data} />
          <CancelReservation code={data.tracking_code} onCancelled={() => void refetch()} />
        </div>
      ) : null}

      {/* ---------------- confirmada ---------------- */}
      {status === 'confirmada' ? (
        <div className="space-y-4">
          <section className="rounded-2xl border border-green-200 bg-green-50 p-5 text-center">
            {/* The check confirms the payment; the mark says who confirms it. */}
            <div className="mx-auto mb-3 flex items-center justify-center gap-3">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand">
                <svg viewBox="0 0 24 24" className="h-9 w-9 text-white" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <LogoMark className="h-8 w-8" />
            </div>
            <h2 className="text-2xl font-extrabold text-brand">
              ¡Lote reservado a tu nombre!
            </h2>
            <p className="mt-1 text-sm text-stone-700">
              A nombre de <span className="font-semibold">{data.buyer_display}</span>
              {data.confirmed_at ? ` · confirmado el ${formatDateTime(data.confirmed_at)}` : ''}
            </p>
            <p className="mt-3 text-sm text-stone-600">
              Tu seña de{' '}
              <span className="font-bold">
                {formatMoney(data.amount_due, data.amount_due_currency)}
              </span>{' '}
              se aplica al precio del lote. La oficina se contactará contigo para coordinar los
              siguientes pasos.
            </p>
          </section>
          <SummaryFromStatus data={data} />

          {/* Cuánto lleva pagado, cuánto le falta y cuándo vence lo próximo:
              la pregunta que la oficina contesta veinte veces por día. */}
          <MiPlanDePago code={data.tracking_code} />

          {/* Sus papeles: el contrato y cada recibo, sin pedirlos a oficina. */}
          <div className="rounded-2xl border border-stone-200 bg-white p-4">
            <p className="text-sm font-bold text-stone-900">Mis documentos</p>
            <Link
              href={`/reserva/${encodeURIComponent(data.tracking_code)}/contrato`}
              className="mt-2 block w-full rounded-xl border border-brand px-4 py-3 text-center text-sm font-bold text-brand active:bg-green-50"
            >
              Ver mi contrato
            </Link>
            {/* Su cronograma: qué cuota le toca y cuándo vence. Si no tiene
                plan, la página lo dice y vuelve. */}
            <Link
              href={`/reserva/${encodeURIComponent(data.tracking_code)}/plan`}
              className="mt-2 block w-full rounded-xl border border-brand px-4 py-3 text-center text-sm font-bold text-brand active:bg-green-50"
            >
              Ver mi plan de pago
            </Link>
            {(data.recibos ?? []).length > 0 ? (
              <ul className="mt-3 divide-y divide-stone-100 border-t border-stone-100">
                {(data.recibos ?? []).map((rc) => (
                  <li key={rc.payment_id}>
                    <Link
                      href={`/reserva/${encodeURIComponent(data.tracking_code)}/recibo/${rc.payment_id}`}
                      className="flex items-center justify-between gap-2 py-2 text-sm"
                    >
                      <span className="text-stone-600">
                        {rc.tipo} · {rc.fecha}
                      </span>
                      <span className="font-semibold tabular-nums text-stone-900">
                        {formatMoney(rc.amount, rc.currency)}
                      </span>
                      <span className="text-xs font-bold text-brand">Recibo →</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <MiPublicacion code={data.tracking_code} />
          <div className="rounded-2xl border border-stone-200 bg-white p-4 text-center">
            <p className="text-sm text-stone-600">Guarda tu código:</p>
            <p className="mt-1 font-mono text-xl font-extrabold text-stone-900">
              {data.tracking_code}
            </p>
            <div className="mt-3">
              <ShareButton code={data.tracking_code} />
            </div>
          </div>
        </div>
      ) : null}

      {/* ---------------- rechazo_reintento ---------------- */}
      {status === 'rechazo_reintento' ? (
        <div className="space-y-4">
          <section className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
            <h2 className="text-lg font-extrabold text-stone-900">
              Hubo un problema con tu comprobante
            </h2>
            <p className="mt-1 text-sm font-semibold text-orange-800">
              {rejectionCopy(data.payment?.rejection_reason)}
            </p>
            {data.payment?.rejection_note ? (
              <p className="mt-1 text-sm text-stone-600">“{data.payment.rejection_note}”</p>
            ) : null}
            <p className="mt-2 text-sm text-stone-600">
              Tu lote sigue reservado. Sube un nuevo comprobante antes de que termine el plazo.
            </p>
          </section>
          <PaymentSection data={data} />
          <ProofUploader
            code={data.tracking_code}
            onUploaded={() => void refetch()}
            heading="Sube un nuevo comprobante"
          />
          <SummaryFromStatus data={data} />
          <CancelReservation code={data.tracking_code} onCancelled={() => void refetch()} />
        </div>
      ) : null}

      {/* ---------------- expirada / cancelada ---------------- */}
      {status === 'expirada' || status === 'cancelada' ? (
        <div className="space-y-4">
          <section className="rounded-2xl border border-stone-200 bg-white p-5 text-center">
            <h2 className="text-xl font-extrabold text-stone-900">
              {status === 'expirada' ? 'Tu reserva expiró' : 'Reserva cancelada'}
            </h2>
            <p className="mt-2 text-sm text-stone-600">
              {status === 'expirada'
                ? 'El plazo de pago terminó y el lote volvió a estar disponible para otras personas. Si ya hiciste la transferencia, contáctanos: es posible que podamos ayudarte.'
                : data.cancel_reason === 'cancelada_por_comprador'
                  ? 'Cancelaste esta reserva y el lote volvió a estar disponible. La seña ya no aplica.'
                  : 'Esta reserva fue cancelada. Si tienes dudas, contáctanos indicando tu código.'}
            </p>
            <Link
              href={MAP_URL}
              className="mt-4 inline-block w-full rounded-xl bg-brand px-4 py-3.5 text-base font-bold text-white active:bg-brand-light"
            >
              Ver lotes disponibles
            </Link>
          </section>
          <SummaryFromStatus data={data} />
        </div>
      ) : null}
    </div>
  );
}
