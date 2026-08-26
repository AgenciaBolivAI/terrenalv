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
  | 'revertir'
  | 'cobrar_sena'
  | 'abonar'
  | 'convertir'
  | 'editar';

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

const FORMA_DE_PAGO: Record<string, string> = {
  efectivo: 'Efectivo',
  manual_qr: 'QR / transferencia',
  banco_ganadero: 'Banco Ganadero',
  bnb: 'BNB',
};

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
  // Cómo viene la reserva: qué pagó de seña, cuánto abonó a cuenta de su
  // cuota inicial y cuánto le falta. Es lo que la oficina necesita ver antes
  // de decidir si le cobra, le extiende el plazo o la deja vencer.
  const [curso, setCurso] = useState<{
    sena_pagada: number;
    abonado: number;
    inicial_objetivo: number;
    falta_para_inicial: number;
    viva: boolean;
    horas_restantes: number | null;
  } | null>(null);
  const [monto, setMonto] = useState('');
  const [dias, setDias] = useState('30');
  const [forma, setForma] = useState<'efectivo' | 'manual_qr' | 'banco_ganadero' | 'bnb'>(
    'efectivo',
  );
  const [edit, setEdit] = useState({ nombre: '', ci: '', tel: '', correo: '', precio: '' });
  const [busy, setBusy] = useState(false);

  // Reject form state
  const [reason, setReason] = useState<RejectionReason>('monto_incorrecto');
  const [note, setNote] = useState('');
  const [allowRetry, setAllowRetry] = useState(true);
  // Hours for extend/reinstate
  const [hours, setHours] = useState(24);

  const isPdf = !!payment?.proof_storage_path?.toLowerCase().endsWith('.pdf');
  const reviewable = payment?.status === 'comprobante_subido' && row.status === 'en_verificacion';
  // Todos los pagos aprobados, no solo el de la seña: una venta que ya arrancó
  // acumula cuotas y abonos y cada uno tiene su papel.
  const pagosAprobados = (row.payments ?? [])
    .filter((p) => p.status === 'aprobado')
    .sort((a, b) => (b.verified_at ?? b.created_at).localeCompare(a.verified_at ?? a.created_at));
  const activeStatuses = ['pendiente_pago', 'en_verificacion', 'rechazo_reintento'];
  const isActive = activeStatuses.includes(row.status);

  // ---- Signed proof URL ----
  // El progreso de la reserva hacia su cuota inicial.
  useEffect(() => {
    let vivo = true;
    void supabase
      .from('v_reservas_en_curso')
      .select('sena_pagada, abonado, inicial_objetivo, falta_para_inicial, viva, horas_restantes')
      .eq('reservation_id', row.id)
      .maybeSingle()
      .then(({ data }) => {
        if (vivo) setCurso((data as typeof curso) ?? null);
      });
    return () => {
      vivo = false;
    };
  }, [supabase, row.id, row.status]);

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
                  {isActive && (
                    <MenuItem
                      label="Cobrar seña y guardar el lote"
                      onClick={() => {
                        setMonto(String(row.amount_due ?? ''));
                        setDias('30');
                        setDialog('cobrar_sena');
                      }}
                    />
                  )}
                  {isActive && (
                    <MenuItem
                      label="Abonar a la cuota inicial"
                      onClick={() => {
                        setMonto(
                          curso && Number(curso.falta_para_inicial) > 0
                            ? String(curso.falta_para_inicial)
                            : '',
                        );
                        setDialog('abonar');
                      }}
                    />
                  )}
                  {isActive && curso && Number(curso.falta_para_inicial) <= 0 && (
                    <MenuItem
                      label="Convertir en venta"
                      onClick={() => { setNote(''); setDialog('convertir'); }}
                    />
                  )}
                  <MenuItem
                    label="Editar datos"
                    onClick={() => {
                      setEdit({
                        nombre: row.buyer_full_name ?? '',
                        ci: row.buyer_ci ?? '',
                        tel: row.buyer_phone ?? '',
                        correo: row.buyer_email ?? '',
                        precio: String(row.price_agreed ?? ''),
                      });
                      setDialog('editar');
                    }}
                  />
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

            {/* Recibos: uno por cada pago aprobado de esta reserva — la seña,
                las cuotas y los abonos. Es LA pantalla donde la oficina tiene
                abierta la venta, así que el papel se emite desde acá sin ir a
                buscar al cliente por Contabilidad. */}
            {pagosAprobados.length > 0 ? (
              <div className="rounded-xl border border-brand-light/40 bg-green-50/60 p-3">
                <p className="text-xs font-semibold tracking-wide text-stone-600 uppercase">
                  Recibos ({pagosAprobados.length})
                </p>
                <ul className="mt-2 space-y-2">
                  {pagosAprobados.map((pg) => (
                    <li
                      key={pg.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2"
                    >
                      <span className="text-xs text-stone-500">
                        {formatDateTime(pg.verified_at ?? pg.created_at)}
                      </span>
                      <Badge className="bg-stone-100 text-stone-600">
                        {pg.purpose === 'cuota' ? 'Cuota' : pg.purpose === 'abono' ? 'Abono' : 'Seña'}
                      </Badge>
                      <span className="text-xs text-stone-500">
                        {FORMA_DE_PAGO[pg.provider] ?? pg.provider}
                      </span>
                      <span className="font-semibold tabular-nums text-stone-900">
                        {formatMoney(pg.amount_bob, 'BOB')}
                      </span>
                      <div className="ml-auto flex gap-1.5">
                        <a
                          href={`/admin/recibo/${pg.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className={btnSecondary}
                        >
                          Recibo
                        </a>
                        <a
                          href={waLink(
                            row.buyer_phone,
                            `Hola ${row.buyer_full_name}, aquí está el recibo de tu pago ` +
                              `de ${formatMoney(pg.amount_bob, 'BOB')} por el lote ` +
                              `${row.lot?.number ?? '—'} de la manzana ${row.lot?.manzana?.code ?? '—'}: ` +
                              `${typeof window === 'undefined' ? '' : window.location.origin}` +
                              `/reserva/${row.tracking_code}/recibo/${pg.id}`,
                          )}
                          target="_blank"
                          rel="noreferrer"
                          className={btnPrimary}
                        >
                          WhatsApp
                        </a>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-stone-500">
                  El enlace de WhatsApp abre el recibo con el código de la reserva: el comprador lo
                  ve sin cuenta, y sólo el suyo.
                </p>
              </div>
            ) : null}

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

            {/* Cómo viene la reserva hacia su cuota inicial: es la pregunta
                que la oficina se hace al atender — ¿le cobro, le extiendo el
                plazo, o la dejo vencer? */}
            {curso && curso.viva && Number(curso.inicial_objetivo) > 0 ? (
              <div className="rounded-xl border border-stone-200 p-3">
                <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-stone-500 uppercase">
                  Camino a la cuota inicial
                </h3>
                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  <div>
                    <p className="text-[11px] text-stone-500">Seña</p>
                    <p className="font-semibold tabular-nums">
                      {formatMoney(Number(curso.sena_pagada), 'BOB')}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-stone-500">Abonado</p>
                    <p className="font-semibold tabular-nums">
                      {formatMoney(Number(curso.abonado), 'BOB')}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-stone-500">Le falta</p>
                    <p
                      className={`font-semibold tabular-nums ${
                        Number(curso.falta_para_inicial) > 0 ? 'text-red-600' : 'text-brand'
                      }`}
                    >
                      {formatMoney(Number(curso.falta_para_inicial), 'BOB')}
                    </p>
                  </div>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-200">
                  <div
                    className="h-full bg-brand"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          ((Number(curso.sena_pagada) + Number(curso.abonado)) /
                            Number(curso.inicial_objetivo)) *
                            100,
                        ),
                      )}%`,
                    }}
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-stone-500">
                  Objetivo {formatMoney(Number(curso.inicial_objetivo), 'BOB')}
                  {curso.horas_restantes !== null ? (
                    <>
                      {' · '}
                      {Number(curso.horas_restantes) > 24
                        ? `${Math.floor(Number(curso.horas_restantes) / 24)} día(s) de plazo`
                        : `${Math.max(0, Math.round(Number(curso.horas_restantes)))} hora(s) de plazo`}
                    </>
                  ) : null}
                  . Al completarla, la reserva se vuelve venta sola.
                </p>
              </div>
            ) : null}

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

      {/* ---- Cobrar la seña y guardar el lote un plazo ---- */}
      <Dialog
        open={dialog === 'cobrar_sena'}
        onClose={() => setDialog(null)}
        title="Cobrar seña y guardar el lote"
      >
        <p className="text-sm text-stone-600">
          Entra la seña al libro y el lote le queda guardado el plazo que elijas. La reserva
          <strong> sigue siendo reserva</strong>: se vuelve venta cuando complete su cuota inicial.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Seña cobrada (Bs)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">Días para juntar la inicial</label>
            <input
              type="number"
              min={1}
              max={365}
              value={dias}
              onChange={(e) => setDias(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
        <div className="mt-3">
          <label className="mb-1 block text-xs text-stone-500">Forma de pago</label>
          <select
            value={forma}
            onChange={(e) => setForma(e.target.value as typeof forma)}
            className={inputClass}
          >
            <option value="efectivo">Efectivo</option>
            <option value="manual_qr">QR / transferencia</option>
            <option value="banco_ganadero">Banco Ganadero</option>
            <option value="bnb">BNB</option>
          </select>
        </div>
        <p className="mt-2 text-xs text-stone-400">
          Si el plazo vence sin completar la cuota inicial, el lote vuelve a la vitrina y la seña
          se pierde.
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
                'admin_cobrar_sena',
                {
                  p_reservation_id: row.id,
                  p_amount: Number(monto) || null,
                  p_provider: forma,
                  p_dias: Number(dias) || null,
                },
                'Seña cobrada. El lote queda guardado.',
                false,
              )
            }
          >
            {busy ? 'Cobrando…' : 'Cobrar seña'}
          </button>
        </div>
      </Dialog>

      {/* ---- Abonar a cuenta de la cuota inicial ---- */}
      <Dialog
        open={dialog === 'abonar'}
        onClose={() => setDialog(null)}
        title="Abonar a la cuota inicial"
      >
        {curso ? (
          <p className="rounded-lg bg-stone-50 p-3 text-sm text-stone-600">
            Lleva pagado {formatMoney(Number(curso.sena_pagada) + Number(curso.abonado), 'BOB')} de{' '}
            {formatMoney(Number(curso.inicial_objetivo), 'BOB')} de cuota inicial
            {Number(curso.falta_para_inicial) > 0 ? (
              <>
                {' '}
                — le faltan{' '}
                <strong>{formatMoney(Number(curso.falta_para_inicial), 'BOB')}</strong>.
              </>
            ) : (
              <> — ya la completó.</>
            )}
          </p>
        ) : null}
        <label className="mt-3 mb-1 block text-xs text-stone-500">Monto (Bs)</label>
        <input
          type="number"
          min={0}
          step="0.01"
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
          className={inputClass}
        />
        <div className="mt-3">
          <label className="mb-1 block text-xs text-stone-500">Forma de pago</label>
          <select
            value={forma}
            onChange={(e) => setForma(e.target.value as typeof forma)}
            className={inputClass}
          >
            <option value="efectivo">Efectivo</option>
            <option value="manual_qr">QR / transferencia</option>
            <option value="banco_ganadero">Banco Ganadero</option>
            <option value="bnb">BNB</option>
          </select>
        </div>
        <p className="mt-2 text-xs text-stone-400">
          Cuando complete la cuota inicial, la reserva se convierte en venta sola.
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
                'admin_register_cuota_payment',
                {
                  p_reservation_id: row.id,
                  p_amount: Number(monto) || 0,
                  p_provider: forma,
                },
                'Abono registrado.',
                false,
              )
            }
          >
            {busy ? 'Registrando…' : 'Registrar abono'}
          </button>
        </div>
      </Dialog>

      {/* ---- Convertir la reserva en venta ---- */}
      <Dialog
        open={dialog === 'convertir'}
        onClose={() => setDialog(null)}
        title="Convertir en venta"
      >
        <p className="text-sm text-stone-600">
          El lote pasa a <strong>vendido</strong> y la reserva se vuelve una venta con su saldo. Lo
          que ya pagó —seña incluida— cuenta contra el precio.
        </p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Nota (opcional)"
          className={`${inputClass} mt-3`}
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
                'admin_confirmar_reserva',
                { p_reservation_id: row.id, p_note: note.trim() || null },
                'Reserva convertida en venta.',
                true,
              )
            }
          >
            {busy ? 'Convirtiendo…' : 'Convertir en venta'}
          </button>
        </div>
      </Dialog>

      {/* ---- Editar los datos de CUALQUIER reserva ---- */}
      <Dialog open={dialog === 'editar'} onClose={() => setDialog(null)} title="Editar datos">
        <p className="text-sm text-stone-600">
          Sirve en cualquier estado — también vencida o cancelada, que es justo cuando el comprador
          aparece al día siguiente y hay que corregirle un dato antes de reactivarla.
        </p>
        <div className="mt-3 space-y-3">
          <input
            value={edit.nombre}
            onChange={(e) => setEdit((v) => ({ ...v, nombre: e.target.value }))}
            placeholder="Nombre completo"
            className={inputClass}
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              value={edit.ci}
              onChange={(e) => setEdit((v) => ({ ...v, ci: e.target.value }))}
              placeholder="CI"
              className={inputClass}
            />
            <input
              value={edit.tel}
              onChange={(e) => setEdit((v) => ({ ...v, tel: e.target.value }))}
              placeholder="Celular"
              inputMode="tel"
              className={inputClass}
            />
          </div>
          <input
            value={edit.correo}
            onChange={(e) => setEdit((v) => ({ ...v, correo: e.target.value }))}
            placeholder="Correo"
            inputMode="email"
            className={inputClass}
          />
          <div>
            <label className="mb-1 block text-xs text-stone-500">Precio pactado (Bs)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={edit.precio}
              onChange={(e) => setEdit((v) => ({ ...v, precio: e.target.value }))}
              className={inputClass}
            />
          </div>
        </div>
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
                'admin_editar_reserva',
                {
                  p_reservation_id: row.id,
                  p_full_name: edit.nombre.trim() || null,
                  p_ci: edit.ci.trim() || null,
                  p_phone: edit.tel.trim() || null,
                  p_email: edit.correo.trim(),
                  p_price: Number(edit.precio) || null,
                },
                'Datos actualizados.',
                false,
              )
            }
          >
            {busy ? 'Guardando…' : 'Guardar'}
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
