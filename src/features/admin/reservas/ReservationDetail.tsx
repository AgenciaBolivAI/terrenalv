'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import { createClient } from '@/lib/supabase/client';
import { formatDateTime, formatMoney, waLink } from '@/lib/format';
import type { RejectionReason, TeamRole } from '@/lib/db-types';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';
import {
  PAYMENT_STATUS_LABEL,
  REJECTION_REASON_LABEL,
  RESERVATION_STATUS_BADGE,
  RESERVATION_STATUS_LABEL,
} from '@/features/admin/lib/labels';
import { fillTemplate, type WhatsappTemplates } from '@/features/admin/lib/whatsapp';
import { Badge, Spinner, btnDanger, btnPrimary, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { Dialog, anyDialogOpen } from '@/features/admin/ui/dialog';
import {
  IconChevronLeft,
  IconChevronRight,
  IconDots,
  IconExternal,
  IconRotate,
  IconWarning,
  IconWhatsapp,
} from '@/features/admin/ui/icons';
import { useToast } from '@/features/admin/ui/toast';
import { reservePayment, type QueueRow } from './types';

type ActionDialog =
  | null
  | 'aprobar'
  | 'rechazar'
  | 'extender'
  | 'pago_manual'
  | 'cancelar'
  | 'reactivar'
  | 'revertir';

interface Props {
  row: QueueRow;
  role: TeamRole;
  waTemplates: WhatsappTemplates;
  onClose: () => void;
  onNavigate: (dir: 1 | -1) => void;
  onActed: (advance: boolean) => void;
}

const REASONS: RejectionReason[] = [
  'monto_incorrecto',
  'comprobante_ilegible',
  'pago_no_encontrado',
  'comprobante_duplicado',
  'otro',
];

function isFormTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export default function ReservationDetail({ row, role, waTemplates, onClose, onNavigate, onActed }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const payment = reservePayment(row);

  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [rotation, setRotation] = useState(0);
  const [dupCount, setDupCount] = useState(0);
  const [dialog, setDialog] = useState<ActionDialog>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Reject form state
  const [reason, setReason] = useState<RejectionReason>('monto_incorrecto');
  const [note, setNote] = useState('');
  const [allowRetry, setAllowRetry] = useState(true);
  // Hours for extend/reinstate
  const [hours, setHours] = useState(24);

  const isPdf = !!payment?.proof_storage_path?.toLowerCase().endsWith('.pdf');
  const reviewable = payment?.status === 'comprobante_subido' && row.status === 'en_verificacion';
  const activeStatuses = ['pendiente_pago', 'en_verificacion', 'rechazo_reintento'];
  const isActive = activeStatuses.includes(row.status);

  // ---- Signed proof URL ----
  useEffect(() => {
    let alive = true;
    setProofUrl(null);
    setProofError(null);
    setRotation(0);
    if (!payment?.proof_storage_path) return;
    fetch(`/api/admin/proof-url?payment=${payment.id}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
        if (!alive) return;
        if (!res.ok || !body?.url) {
          setProofError(body?.error ?? 'No se pudo cargar el comprobante.');
          return;
        }
        setProofUrl(body.url);
      })
      .catch(() => {
        if (alive) setProofError('No se pudo cargar el comprobante.');
      });
    return () => {
      alive = false;
    };
  }, [payment?.id, payment?.proof_storage_path, payment?.proof_submitted_at]);

  // ---- Duplicate proof detection ----
  useEffect(() => {
    let alive = true;
    setDupCount(0);
    if (!payment?.proof_sha256) return;
    void supabase
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('proof_sha256', payment.proof_sha256)
      .neq('id', payment.id)
      .then(({ count }) => {
        if (alive) setDupCount(count ?? 0);
      });
    return () => {
      alive = false;
    };
  }, [supabase, payment?.id, payment?.proof_sha256]);

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (anyDialogOpen() || isFormTarget(e)) return;
      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          onNavigate(1);
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          onNavigate(-1);
          break;
        case 'a':
          if (reviewable) setDialog('aprobar');
          break;
        case 'r':
          if (reviewable) openReject();
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [reviewable, onClose, onNavigate]);

  function openReject() {
    setReason('monto_incorrecto');
    setNote('');
    setAllowRetry(true);
    setDialog('rechazar');
  }

  function pickReason(r: RejectionReason) {
    setReason(r);
    // Duplicates should not get an automatic retry.
    setAllowRetry(r !== 'comprobante_duplicado');
  }

  const runRpc = useCallback(
    async (fn: string, args: Record<string, unknown>, okMsg: string, advance: boolean) => {
      setBusy(true);
      const { error } = await supabase.rpc(fn, args);
      setBusy(false);
      if (error) {
        push(adminErrorCopy(error.message), 'error');
        return;
      }
      push(okMsg, 'success');
      setDialog(null);
      setMenuOpen(false);
      onActed(advance);
    },
    [supabase, push, onActed],
  );

  const mzCode = row.lot?.manzana?.code ?? '—';
  const lotNumber = row.lot?.number ?? '—';
  const waContacto = fillTemplate(waTemplates.contacto, {
    nombre: row.buyer_full_name.split(' ')[0] ?? '',
    codigo: row.tracking_code,
    lote: lotNumber,
    manzana: mzCode,
  });

  const timeline: { label: string; at: string | null }[] = [
    { label: 'Reserva creada', at: row.created_at },
    { label: 'Comprobante subido', at: payment?.proof_submitted_at ?? null },
    { label: 'Confirmada', at: row.confirmed_at },
    { label: 'Cancelada', at: row.cancelled_at },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <section className="relative flex h-full w-full flex-col bg-white shadow-2xl md:max-w-3xl">
        {/* Header */}
        <header className="flex items-center gap-2 border-b border-stone-200 px-3 py-2.5 sm:px-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100 md:hidden"
            aria-label="Volver"
          >
            <IconChevronLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-sm font-bold text-stone-900">{row.tracking_code}</p>
            <p className="truncate text-xs text-stone-500">
              Mz {mzCode} · Lote {lotNumber}
              {row.source === 'oficina' ? ' · venta en oficina' : ''}
            </p>
          </div>
          <Badge className={RESERVATION_STATUS_BADGE[row.status]}>
            {RESERVATION_STATUS_LABEL[row.status]}
          </Badge>
          <div className="hidden items-center gap-1 md:flex">
            <button
              type="button"
              onClick={() => onNavigate(-1)}
              className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100"
              aria-label="Anterior (k)"
            >
              <IconChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate(1)}
              className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100"
              aria-label="Siguiente (j)"
            >
              <IconChevronRight className="h-5 w-5" />
            </button>
          </div>
          {/* Actions menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100"
              aria-label="Más acciones"
            >
              <IconDots className="h-5 w-5" />
            </button>
            {menuOpen ? (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden />
                <div className="absolute right-0 z-50 mt-1 w-60 rounded-xl border border-stone-200 bg-white py-1 shadow-xl">
                  {(row.status === 'pendiente_pago' || row.status === 'rechazo_reintento') && (
                    <MenuItem label="Extender plazo" onClick={() => { setHours(24); setDialog('extender'); }} />
                  )}
                  {isActive && (
                    <MenuItem label="Registrar pago manual" onClick={() => { setNote(''); setDialog('pago_manual'); }} />
                  )}
                  {(row.status === 'expirada' || row.status === 'cancelada') && (
                    <MenuItem label="Reactivar reserva" onClick={() => { setHours(24); setDialog('reactivar'); }} />
                  )}
                  {isActive && role === 'admin' && (
                    <MenuItem danger label="Cancelar reserva" onClick={() => { setNote(''); setDialog('cancelar'); }} />
                  )}
                  {row.status === 'confirmada' && role === 'admin' && (
                    <MenuItem danger label="Revertir venta" onClick={() => { setNote(''); setDialog('revertir'); }} />
                  )}
                </div>
              </>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="hidden rounded-lg p-1.5 text-stone-500 hover:bg-stone-100 md:block"
            aria-label="Cerrar (Esc)"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {/* Body */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:grid md:grid-cols-2 md:overflow-hidden">
          {/* Proof viewer */}
          <div className="relative flex h-[42dvh] shrink-0 flex-col bg-stone-900 md:h-auto">
            {payment?.proof_storage_path ? (
              proofError ? (
                <p className="m-auto px-6 text-center text-sm text-stone-300">{proofError}</p>
              ) : !proofUrl ? (
                <div className="m-auto text-stone-300">
                  <Spinner label="Cargando comprobante…" />
                </div>
              ) : isPdf ? (
                <iframe src={proofUrl} title="Comprobante PDF" className="h-full w-full bg-white" />
              ) : (
                <TransformWrapper minScale={0.3} maxScale={8} centerOnInit>
                  <TransformComponent
                    wrapperStyle={{ width: '100%', height: '100%' }}
                    contentStyle={{ width: '100%', height: '100%' }}
                  >
                    <div className="flex h-full w-full items-center justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={proofUrl}
                        alt={`Comprobante de ${row.tracking_code}`}
                        className="max-h-full max-w-full object-contain"
                        style={{ transform: `rotate(${rotation}deg)` }}
                      />
                    </div>
                  </TransformComponent>
                </TransformWrapper>
              )
            ) : (
              <p className="m-auto px-6 text-center text-sm text-stone-300">
                El comprador aún no subió su comprobante.
              </p>
            )}
            {payment?.proof_storage_path && proofUrl ? (
              <div className="absolute right-2 bottom-2 flex gap-1.5">
                {!isPdf ? (
                  <button
                    type="button"
                    onClick={() => setRotation((r) => (r + 90) % 360)}
                    className="rounded-lg bg-black/60 p-2 text-white hover:bg-black/80"
                    aria-label="Rotar"
                  >
                    <IconRotate className="h-4 w-4" />
                  </button>
                ) : null}
                <a
                  href={proofUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-black/60 px-2.5 py-2 text-xs font-medium text-white hover:bg-black/80"
                >
                  <IconExternal className="h-4 w-4" /> Abrir original
                </a>
              </div>
            ) : null}
          </div>

          {/* Info column */}
          <div className="flex flex-col gap-4 p-4 md:overflow-y-auto">
            {dupCount > 0 ? (
              <div className="flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                <IconWarning className="mt-0.5 h-5 w-5 shrink-0" />
                <p>
                  <strong>Posible comprobante duplicado:</strong> esta misma imagen aparece en{' '}
                  {dupCount + 1} pagos. Verifica antes de aprobar.
                </p>
              </div>
            ) : null}

            {/* Expected amount */}
            <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 text-center">
              <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                Monto esperado
              </p>
              <p className="mt-1 text-4xl font-black text-brand">
                {payment
                  ? formatMoney(payment.amount_bob, 'BOB')
                  : formatMoney(row.amount_due, row.amount_due_currency)}
              </p>
              {payment && payment.currency !== 'BOB' ? (
                <p className="text-xs text-stone-500">
                  ({formatMoney(payment.amount, payment.currency)})
                </p>
              ) : null}
              {payment ? (
                <div className="mt-2">
                  <p className="text-xs text-stone-500">Referencia esperada en la glosa:</p>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(payment.reference_code);
                      push('Referencia copiada.', 'info');
                    }}
                    className="mt-1 rounded-lg border border-stone-300 bg-white px-2.5 py-1 font-mono text-sm font-semibold text-stone-800 hover:bg-stone-100"
                    title="Copiar"
                  >
                    {payment.reference_code}
                  </button>
                  <p className="mt-1.5 text-[11px] text-stone-400">
                    Pago: {PAYMENT_STATUS_LABEL[payment.status]}
                    {payment.rejection_reason
                      ? ` · ${REJECTION_REASON_LABEL[payment.rejection_reason]}`
                      : ''}
                  </p>
                </div>
              ) : null}
            </div>

            {/* Approve / Reject */}
            {reviewable ? (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setDialog('aprobar')}
                  className={`${btnPrimary} py-3`}
                >
                  Aprobar <span className="hidden rounded bg-white/20 px-1 text-[10px] md:inline">A</span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={openReject}
                  className={`${btnDanger} py-3`}
                >
                  Rechazar <span className="hidden rounded bg-white/20 px-1 text-[10px] md:inline">R</span>
                </button>
              </div>
            ) : null}

            {/* Buyer */}
            <div>
              <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-stone-500 uppercase">
                Comprador
              </h3>
              <div className="rounded-xl border border-stone-200 p-3 text-sm">
                <p className="font-medium text-stone-900">{row.buyer_full_name}</p>
                <p className="mt-0.5 text-stone-600">CI: {row.buyer_ci}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="text-stone-600">{row.buyer_phone}</span>
                  <a
                    href={waLink(row.buyer_phone, waContacto)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-2 py-1 text-xs font-semibold text-white hover:bg-green-700"
                  >
                    <IconWhatsapp className="h-3.5 w-3.5" /> WhatsApp
                  </a>
                </div>
                {row.buyer_email ? <p className="mt-1 text-stone-600">{row.buyer_email}</p> : null}
              </div>
            </div>

            {/* Lot */}
            <div>
              <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-stone-500 uppercase">
                Lote
              </h3>
              <div className="rounded-xl border border-stone-200 p-3 text-sm text-stone-700">
                <p>
                  Manzana <strong>{mzCode}</strong> · Lote <strong>{lotNumber}</strong>
                </p>
                <p className="mt-0.5">
                  Precio acordado: <strong>{formatMoney(row.price_agreed, row.currency)}</strong>
                </p>
                <p className="mt-0.5">
                  Seña a pagar: <strong>{formatMoney(row.amount_due, row.amount_due_currency)}</strong>
                </p>
                {row.cancel_reason ? (
                  <p className="mt-0.5 text-red-700">Motivo: {row.cancel_reason}</p>
                ) : null}
              </div>
            </div>

            {/* Timeline */}
            <div>
              <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-stone-500 uppercase">
                Línea de tiempo
              </h3>
              <ul className="space-y-1.5 rounded-xl border border-stone-200 p-3 text-sm">
                {timeline
                  .filter((t) => t.at)
                  .map((t) => (
                    <li key={t.label} className="flex justify-between gap-3">
                      <span className="text-stone-600">{t.label}</span>
                      <span className="text-stone-500">{formatDateTime(t.at as string)}</span>
                    </li>
                  ))}
                {row.hold_expires_at && row.status === 'pendiente_pago' ? (
                  <li className="flex justify-between gap-3">
                    <span className="text-stone-600">Vence</span>
                    <span className="font-medium text-amber-700">
                      {formatDateTime(row.hold_expires_at)}
                    </span>
                  </li>
                ) : null}
                {row.retry_expires_at && row.status === 'rechazo_reintento' ? (
                  <li className="flex justify-between gap-3">
                    <span className="text-stone-600">Reintento vence</span>
                    <span className="font-medium text-amber-700">
                      {formatDateTime(row.retry_expires_at)}
                    </span>
                  </li>
                ) : null}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ---- Dialogs ---- */}
      <Dialog open={dialog === 'aprobar'} onClose={() => setDialog(null)} title="Aprobar pago">
        <p className="text-sm text-stone-600">
          ¿Confirmas que recibiste{' '}
          <strong className="text-stone-900">
            {payment ? formatMoney(payment.amount_bob, 'BOB') : '—'}
          </strong>{' '}
          con la referencia <span className="font-mono">{payment?.reference_code}</span>?
        </p>
        <p className="mt-2 text-xs text-stone-400">
          El lote pasará a <strong>vendido</strong> y se avisará al comprador.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={() => setDialog(null)}>
            Volver
          </button>
          <button
            type="button"
            disabled={busy || !payment}
            className={btnPrimary}
            onClick={() =>
              payment &&
              void runRpc(
                'approve_payment',
                { p_payment_id: payment.id },
                'Pago aprobado — reserva confirmada.',
                true,
              )
            }
          >
            {busy ? 'Aprobando…' : `Sí, recibí ${payment ? formatMoney(payment.amount_bob, 'BOB') : ''}`}
          </button>
        </div>
      </Dialog>

      <Dialog open={dialog === 'rechazar'} onClose={() => setDialog(null)} title="Rechazar comprobante">
        <div className="space-y-2">
          {REASONS.map((r) => (
            <label key={r} className="flex cursor-pointer items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm has-checked:border-red-400 has-checked:bg-red-50">
              <input
                type="radio"
                name="motivo"
                checked={reason === r}
                onChange={() => pickReason(r)}
                className="accent-red-600"
              />
              {REJECTION_REASON_LABEL[r]}
            </label>
          ))}
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Nota para el comprador (opcional)"
          rows={2}
          className={`${inputClass} mt-3`}
        />
        <label className="mt-3 flex items-center gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={allowRetry}
            onChange={(e) => setAllowRetry(e.target.checked)}
            className="accent-brand"
          />
          Permitir que vuelva a subir el comprobante
        </label>
        {!allowRetry ? (
          <p className="mt-1 text-xs text-red-600">
            Sin reintento la reserva se cancela y el lote vuelve a estar disponible.
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={() => setDialog(null)}>
            Volver
          </button>
          <button
            type="button"
            disabled={busy || !payment}
            className={btnDanger}
            onClick={() =>
              payment &&
              void runRpc(
                'reject_payment',
                {
                  p_payment_id: payment.id,
                  p_reason: reason,
                  p_note: note.trim() || null,
                  p_allow_retry: allowRetry,
                },
                allowRetry ? 'Comprobante rechazado — se permitió reintento.' : 'Comprobante rechazado y reserva cancelada.',
                true,
              )
            }
          >
            {busy ? 'Rechazando…' : 'Rechazar'}
          </button>
        </div>
      </Dialog>

      <Dialog open={dialog === 'extender'} onClose={() => setDialog(null)} title="Extender plazo">
        <label className="mb-1 block text-sm font-medium text-stone-700">Horas adicionales</label>
        <input
          type="number"
          min={1}
          max={720}
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
          className={inputClass}
        />
        <p className="mt-2 text-xs text-stone-400">
          Se suman al vencimiento actual (o desde ahora si ya venció).
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={() => setDialog(null)}>
            Volver
          </button>
          <button
            type="button"
            disabled={busy}
            className={btnPrimary}
            onClick={() =>
              void runRpc(
                'admin_extend_hold',
                { p_reservation_id: row.id, p_hours: hours },
                `Plazo extendido ${hours} horas.`,
                false,
              )
            }
          >
            {busy ? 'Guardando…' : 'Extender'}
          </button>
        </div>
      </Dialog>

      <Dialog open={dialog === 'pago_manual'} onClose={() => setDialog(null)} title="Registrar pago manual">
        <p className="text-sm text-stone-600">
          Para cuando el comprador pagó pero nunca subió el comprobante. El pago se marca como
          aprobado y la reserva pasa a <strong>confirmada</strong>.
        </p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Nota obligatoria: cómo verificaste el pago (ej. extracto bancario 26/07, Bs 1.000)"
          rows={3}
          className={`${inputClass} mt-3`}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={() => setDialog(null)}>
            Volver
          </button>
          <button
            type="button"
            disabled={busy || note.trim().length === 0}
            className={btnPrimary}
            onClick={() =>
              void runRpc(
                'attach_payment_on_behalf',
                { p_reservation_id: row.id, p_note: note.trim() },
                'Pago registrado — reserva confirmada.',
                true,
              )
            }
          >
            {busy ? 'Guardando…' : 'Registrar y confirmar'}
          </button>
        </div>
      </Dialog>

      <Dialog open={dialog === 'cancelar'} onClose={() => setDialog(null)} title="Cancelar reserva">
        <p className="text-sm text-stone-600">
          El lote volverá a estar <strong>disponible</strong>. Esta acción queda en la auditoría.
        </p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Motivo (opcional)"
          rows={2}
          className={`${inputClass} mt-3`}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={() => setDialog(null)}>
            Volver
          </button>
          <button
            type="button"
            disabled={busy}
            className={btnDanger}
            onClick={() =>
              void runRpc(
                'admin_cancel_reservation',
                { p_reservation_id: row.id, p_note: note.trim() || null },
                'Reserva cancelada.',
                true,
              )
            }
          >
            {busy ? 'Cancelando…' : 'Cancelar reserva'}
          </button>
        </div>
      </Dialog>

      <Dialog open={dialog === 'reactivar'} onClose={() => setDialog(null)} title="Reactivar reserva">
        <p className="text-sm text-stone-600">
          La reserva vuelve a <strong>esperando pago</strong> y el lote se reserva de nuevo (solo si
          sigue disponible).
        </p>
        <label className="mt-3 mb-1 block text-sm font-medium text-stone-700">
          Horas de plazo desde ahora
        </label>
        <input
          type="number"
          min={1}
          max={720}
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
          className={inputClass}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={() => setDialog(null)}>
            Volver
          </button>
          <button
            type="button"
            disabled={busy}
            className={btnPrimary}
            onClick={() =>
              void runRpc(
                'admin_reinstate_reservation',
                { p_reservation_id: row.id, p_hours: hours },
                'Reserva reactivada.',
                true,
              )
            }
          >
            {busy ? 'Reactivando…' : 'Reactivar'}
          </button>
        </div>
      </Dialog>

      <Dialog open={dialog === 'revertir'} onClose={() => setDialog(null)} title="Revertir venta">
        <p className="text-sm text-stone-600">
          Revierte una venta confirmada (disputa o devolución). El lote volverá a{' '}
          <strong>disponible</strong>. La devolución del dinero se gestiona fuera del sistema.
        </p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Nota obligatoria: motivo de la reversión"
          rows={3}
          className={`${inputClass} mt-3`}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={() => setDialog(null)}>
            Volver
          </button>
          <button
            type="button"
            disabled={busy || note.trim().length === 0}
            className={btnDanger}
            onClick={() =>
              void runRpc(
                'admin_revert_sale',
                { p_reservation_id: row.id, p_note: note.trim() },
                'Venta revertida.',
                true,
              )
            }
          >
            {busy ? 'Revirtiendo…' : 'Revertir venta'}
          </button>
        </div>
      </Dialog>
    </div>
  );
}

function MenuItem({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full px-3 py-2 text-left text-sm hover:bg-stone-50 ${
        danger ? 'text-red-700' : 'text-stone-700'
      }`}
    >
      {label}
    </button>
  );
}
