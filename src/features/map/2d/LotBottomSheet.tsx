'use client';

// Lot detail bottom sheet (vaul, non-modal: the map stays visible + usable).
// Reacts live to the selected lot's status: if it flips to 'reservado' while
// open, the CTA is swapped for an honest warning.

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Drawer } from 'vaul';
import type { LotStatus } from '@/lib/db-types';
import { computeFinancing, formatPct, type FinancingPlan } from '@/lib/financing';
import { formatArea, formatMoney, waLink } from '@/lib/format';
import type { MapProjectInfo } from '../data/loadGeometry';
import { useMapStore } from '../store/useMapStore';

// The peek snap has to clear everything down to "Reservar este lote"; the
// payment plan added a row, so it needs a little more height than before.
const SNAP_PEEK = 0.6;
const SNAP_FULL = 0.94;

const STATUS_LABEL: Record<LotStatus, string> = {
  disponible: 'Disponible',
  reservado: 'Reservado',
  vendido: 'Vendido',
  no_disponible: 'No disponible',
};

const STATUS_BADGE: Record<LotStatus, string> = {
  disponible: 'bg-green-100 text-green-800 ring-green-300',
  reservado: 'bg-orange-100 text-orange-800 ring-orange-300',
  vendido: 'bg-stone-200 text-stone-600 ring-stone-300',
  no_disponible: 'bg-stone-100 text-stone-500 ring-stone-200',
};

export function LotBottomSheet({
  project,
  financingPlan = null,
}: {
  project: MapProjectInfo;
  financingPlan?: FinancingPlan | null;
}) {
  const selectedLotId = useMapStore((s) => s.selectedLotId);
  const lots = useMapStore((s) => s.lots);
  const manzanas = useMapStore((s) => s.manzanas);
  const entry = useMapStore((s) => (s.selectedLotId ? s.statusByLotId[s.selectedLotId] : undefined));
  const selectLot = useMapStore((s) => s.selectLot);

  const [snap, setSnap] = useState<number | string | null>(SNAP_PEEK);

  // Status at open time, per lot — to detect a live flip while the sheet is up.
  const initialRef = useRef<{ id: string; st: LotStatus | null } | null>(null);
  useEffect(() => {
    if (selectedLotId) {
      setSnap(SNAP_PEEK);
      const st = useMapStore.getState().statusByLotId[selectedLotId]?.st ?? null;
      initialRef.current = { id: selectedLotId, st };
    } else {
      initialRef.current = null;
    }
  }, [selectedLotId]);

  // Escape closes (vaul only handles Esc in modal mode).
  useEffect(() => {
    if (!selectedLotId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') selectLot(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedLotId, selectLot]);

  const lot = selectedLotId ? lots.get(selectedLotId) : undefined;
  const manzana = lot ? manzanas.find((m) => m.id === lot.manzanaId) : undefined;
  const open = !!lot;

  const st: LotStatus = entry?.st ?? 'no_disponible';
  const priced = !!entry?.priced && typeof entry?.price === 'number';
  const financing = priced ? computeFinancing(entry?.price, financingPlan) : null;
  const isSeed = !!lot && lot.id.startsWith('seed-');
  const flipped =
    !!lot &&
    initialRef.current?.id === lot.id &&
    initialRef.current.st === 'disponible' &&
    st !== 'disponible';

  const shareLot = () => {
    if (!lot || typeof window === 'undefined') return;
    const text = `Mira el Lote ${lot.number}, Manzana ${manzana?.code ?? ''} en ${project.name}: ${window.location.href}`;
    window.open(waLink('', text), '_blank', 'noopener,noreferrer');
  };

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) selectLot(null);
      }}
      modal={false}
      snapPoints={[SNAP_PEEK, SNAP_FULL]}
      activeSnapPoint={snap}
      setActiveSnapPoint={setSnap}
    >
      <Drawer.Portal>
        <Drawer.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 flex h-full max-h-[94%] flex-col rounded-t-2xl border-t border-stone-200 bg-white shadow-[0_-8px_30px_rgba(0,0,0,0.15)] outline-none"
        >
          {lot ? (
            <>
              {/* Drag/close header: NOT scrollable, so swipe-down always dismisses. */}
              <div className="shrink-0 px-5 pt-3">
                <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-stone-300" aria-hidden="true" />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Drawer.Title className="truncate text-lg font-bold text-stone-900">
                      Manzana {manzana?.code ?? '—'} · Lote {lot.number}
                    </Drawer.Title>
                    <p className="mt-0.5 text-xs text-stone-500">
                      {manzana?.sector ? `Sector ${manzana.sector}` : project.name}
                      {lot.corner ? ' · Lote esquinero' : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${STATUS_BADGE[st]}`}
                    >
                      {STATUS_LABEL[st]}
                    </span>
                    <button
                      type="button"
                      onClick={() => selectLot(null)}
                      aria-label="Cerrar"
                      className="flex h-11 w-11 items-center justify-center rounded-full bg-stone-100 text-stone-500 active:bg-stone-200"
                    >
                      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                        <path d="M5 5l10 10M15 5L5 15" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-8">
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-stone-50 px-2 py-2.5">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">Frente</dt>
                  <dd className="mt-0.5 text-sm font-bold text-stone-800">
                    {lot.frontage != null ? `${lot.frontage} m` : '—'}
                  </dd>
                </div>
                <div className="rounded-xl bg-stone-50 px-2 py-2.5">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">Fondo</dt>
                  <dd className="mt-0.5 text-sm font-bold text-stone-800">
                    {lot.depth != null ? `${lot.depth} m` : '—'}
                  </dd>
                </div>
                <div className="rounded-xl bg-stone-50 px-2 py-2.5">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">Superficie</dt>
                  <dd className="mt-0.5 text-sm font-bold text-stone-800">{formatArea(lot.area)}</dd>
                </div>
              </dl>

              <div className="mt-4 flex items-baseline justify-between rounded-xl bg-brand/5 px-4 py-3">
                <span className="text-xs font-medium text-stone-600">Precio</span>
                {priced && entry?.price != null ? (
                  <span className="text-xl font-extrabold text-brand">
                    {formatMoney(entry.price, project.currency)}
                  </span>
                ) : (
                  <span className="text-sm font-semibold text-stone-500">Precio por confirmar</span>
                )}
              </div>

              {/* Deliberately compact: this sits above the "Reservar" button,
                  and at the peek snap a taller block pushes the CTA off screen
                  on a small phone. */}
              {financing ? (
                <dl className="mt-2 rounded-xl border border-stone-200 px-4 py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-xs text-stone-600">
                      Cuota inicial ({formatPct(financing.downPaymentPct)})
                    </dt>
                    <dd className="text-sm font-bold text-stone-800">
                      {formatMoney(financing.downPayment, project.currency)}
                    </dd>
                  </div>
                  <div className="mt-0.5 flex items-baseline justify-between gap-3">
                    <dt className="text-xs text-stone-600">
                      {financing.months} cuotas
                      {financing.annualInterestPct > 0
                        ? ` al ${formatPct(financing.annualInterestPct)} anual`
                        : ' sin interés'}
                    </dt>
                    <dd className="text-base font-extrabold text-brand">
                      {formatMoney(financing.monthly, project.currency)}
                      <span className="text-xs font-semibold text-stone-500">/mes</span>
                    </dd>
                  </div>
                </dl>
              ) : null}

              {flipped ? (
                <div className="mt-4 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-medium text-orange-800">
                  ⚠️ Este lote acaba de ser reservado por otra persona.
                </div>
              ) : null}

              <div className="mt-4 flex flex-col gap-2">
                {flipped ? (
                  <button
                    type="button"
                    onClick={() => selectLot(null)}
                    className="w-full rounded-full bg-brand py-3 text-center text-sm font-bold text-white active:bg-brand-light"
                  >
                    Ver otros lotes
                  </button>
                ) : isSeed ? (
                  <div className="rounded-xl bg-stone-100 px-4 py-3 text-center text-sm font-medium text-stone-600">
                    Muy pronto podrás reservar en línea
                  </div>
                ) : st === 'disponible' && priced ? (
                  <Link
                    href={`/reservar/${lot.id}`}
                    className="w-full rounded-full bg-brand py-3 text-center text-sm font-bold text-white active:bg-brand-light"
                  >
                    Reservar este lote
                  </Link>
                ) : st === 'disponible' ? (
                  <button
                    type="button"
                    disabled
                    className="w-full cursor-not-allowed rounded-full bg-stone-200 py-3 text-center text-sm font-bold text-stone-400"
                  >
                    Aún no habilitado
                  </button>
                ) : (
                  <p className="rounded-xl bg-stone-100 px-4 py-3 text-center text-sm font-medium text-stone-600">
                    {st === 'reservado'
                      ? 'Este lote está reservado por otra persona.'
                      : st === 'vendido'
                        ? 'Este lote ya fue vendido.'
                        : 'Este lote no está disponible.'}
                  </p>
                )}

                <button
                  type="button"
                  onClick={shareLot}
                  className="w-full rounded-full border border-brand/30 bg-white py-3 text-center text-sm font-semibold text-brand active:bg-brand/5"
                >
                  Compartir por WhatsApp
                </button>
              </div>
              </div>
            </>
          ) : (
            <Drawer.Title className="sr-only">Lote</Drawer.Title>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
