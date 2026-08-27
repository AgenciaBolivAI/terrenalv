'use client';

// El historial de UN lote, en su propia pantalla.
//
// Antes esto vivía dentro de la ficha del cliente, plegado bajo un movimiento
// entre otros. Cuando alguien tiene tres lotes, mirar «el historial de este
// lote» dentro de una lista de lotes es pedir confundirse. Acá el código del
// lote está arriba de todo y no hay nada más en pantalla.
//
// Arriba, la cuenta completa: lo acordado, lo que fue contra el precio, el
// interés aparte y lo que falta. Un pago que dice Bs 50.000 no significa nada
// si no se sabe contra qué precio.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/format';
import { Badge, EmptyState, Spinner } from '@/features/admin/ui/bits';
import { dateLabel } from '@/features/admin/contabilidad/types';
import { EnviarReciboWhatsapp } from '@/features/admin/contabilidad/EnviarReciboWhatsapp';
import AnularPagoDialog, { type PagoAnulable } from '@/features/admin/contabilidad/AnularPago';

interface Lote {
  reservation_id: string;
  tracking_code: string;
  estado: string;
  proyecto: string;
  manzana: string | null;
  lote: string | null;
  price_agreed: number;
  pagado_total: number | null;
  saldo: number | null;
  buyer_full_name: string;
  buyer_phone: string | null;
  ci_norm: string;
  area_m2: number | null;
  origen_label: string;
  recibida_por_traspaso: boolean;
  cedida_por_traspaso: boolean;
  cedida_a_tracking: string | null;
  traspaso_de_comprador: string | null;
  deuda_migrada: number | null;
  abonado_migrado: number | null;
}

interface Pago {
  payment_id: string;
  tipo: string;
  forma: string;
  estado: string;
  amount_bob: number;
  fecha: string | null;
  created_at: string;
  tiene_recibo: boolean;
  de_comprador_anterior: boolean;
  buyer_full_name: string;
  buyer_phone: string | null;
  reference_code: string | null;
  motivo_rechazo: string | null;
}

export default function LoteHistorial({ reservationId }: { reservationId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [l, setL] = useState<Lote | null>(null);
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [loading, setLoading] = useState(true);
  // El pago que se está por anular: abre el diálogo de anulación/devolución.
  const [anular, setAnular] = useState<PagoAnulable | null>(null);

  const cargar = useCallback(async () => {
    const [a, p] = await Promise.all([
      supabase
        .from('v_cliente_actividad')
        .select('*')
        .eq('reservation_id', reservationId)
        .maybeSingle(),
      supabase
        .from('v_historial_pagos_cadena')
        .select('*')
        .eq('venta_id', reservationId)
        .order('created_at', { ascending: false }),
    ]);
    setL((a.data as Lote | null) ?? null);
    setPagos((p.data ?? []) as unknown as Pago[]);
    setLoading(false);
  }, [supabase, reservationId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (!l) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title="No encontré ese lote"
          hint="Puede que la venta se haya anulado. Volvé a Clientes y abrí la ficha de nuevo."
        />
      </div>
    );
  }

  const aprobados = pagos.filter((p) => p.estado === 'aprobado');
  const cobrado = aprobados.reduce((s, p) => s + Number(p.amount_bob), 0);
  const heredados = aprobados.filter((p) => p.de_comprador_anterior);
  // La base contra la que se mide la deuda: en una venta migrada es la deuda
  // reportada, no el precio — el resto se pagó en el sistema anterior.
  const base = l.deuda_migrada ?? Number(l.price_agreed);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link
        href={`/admin/clientes?ci=${encodeURIComponent(l.ci_norm)}`}
        className="text-sm font-semibold text-brand hover:underline"
      >
        ← Volver a la ficha de {l.buyer_full_name}
      </Link>

      {/* El código del lote, primero y grande: es lo que evita confundirse. */}
      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-bold text-stone-900">
            Manzana {l.manzana ?? '—'}, Lote {l.lote ?? '—'}
          </h1>
          <span className="font-mono text-sm font-semibold text-brand">{l.tracking_code}</span>
          <Badge className="bg-stone-100 text-stone-600">{l.estado}</Badge>
          {l.area_m2 ? (
            <span className="text-xs text-stone-400">{Number(l.area_m2)} m²</span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-stone-600">
          {l.proyecto} · {l.buyer_full_name}
          {l.buyer_phone ? ` · ${l.buyer_phone}` : ''}
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg bg-stone-50 p-3">
            <dt className="text-xs text-stone-500">Valor acordado</dt>
            <dd className="mt-0.5 text-lg font-bold tabular-nums text-stone-900">
              {formatMoney(Number(l.price_agreed), 'BOB')}
            </dd>
          </div>
          <div className="rounded-lg bg-stone-50 p-3">
            <dt className="text-xs text-stone-500">Pagado</dt>
            <dd className="mt-0.5 text-lg font-bold tabular-nums text-brand">
              {formatMoney(Number(l.pagado_total ?? 0), 'BOB')}
            </dd>
          </div>
          <div className="rounded-lg bg-stone-50 p-3">
            <dt className="text-xs text-stone-500">Le queda</dt>
            <dd
              className={`mt-0.5 text-lg font-bold tabular-nums ${
                Number(l.saldo ?? 0) > 0 ? 'text-red-600' : 'text-stone-900'
              }`}
            >
              {l.saldo === null ? '—' : formatMoney(Number(l.saldo), 'BOB')}
            </dd>
          </div>
          <div className="rounded-lg bg-stone-50 p-3">
            <dt className="text-xs text-stone-500">Cómo llegó</dt>
            <dd className="mt-0.5 text-sm font-medium text-stone-700">{l.origen_label}</dd>
          </div>
        </dl>

        {l.deuda_migrada !== null ? (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Venta migrada del sistema anterior: el saldo se mide contra la deuda reportada de{' '}
            {formatMoney(Number(l.deuda_migrada), 'BOB')}, no contra el precio. Lo abonado allá
            ({formatMoney(Number(l.abonado_migrado ?? 0), 'BOB')}) no está pago por pago acá.
          </p>
        ) : null}

        {l.recibida_por_traspaso ? (
          <p className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
            Este lote le llegó por traspaso
            {l.traspaso_de_comprador ? ` de ${l.traspaso_de_comprador}` : ''}. Los pagos del dueño
            anterior están abajo, marcados: son parte de la historia de este lote.
          </p>
        ) : null}

        {l.cedida_por_traspaso ? (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Este lote ya no es suyo: lo cedió por traspaso
            {l.cedida_a_tracking ? ` (ahora es ${l.cedida_a_tracking})` : ''}.
          </p>
        ) : null}
      </div>

      {/* La cuenta de los pagos */}
      <section className="rounded-xl border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-4 py-3">
          <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
            Historial de pagos de este lote
          </p>
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-sm text-stone-500">
            Aprobado
            <strong className="text-base tabular-nums text-stone-900">
              {formatMoney(cobrado, 'BOB')}
            </strong>
            <span className="text-xs">
              en {aprobados.length} pago(s)
              {pagos.length > aprobados.length
                ? ` · ${pagos.length - aprobados.length} intento(s) sin aprobar`
                : ''}
              {heredados.length > 0 ? ` · ${heredados.length} del dueño anterior` : ''}
            </span>
          </p>
          {base > 0 ? (
            <p className="mt-1 text-xs text-stone-400">
              Contra {formatMoney(base, 'BOB')}
              {l.saldo !== null && Number(l.saldo) === 0
                ? ' — cancelado.'
                : l.saldo !== null
                  ? ` — falta ${formatMoney(Number(l.saldo), 'BOB')}.`
                  : '.'}
            </p>
          ) : null}
        </div>

        {pagos.length === 0 ? (
          <div className="px-4 py-8">
            <EmptyState
              title="Sin pagos registrados en este sistema"
              hint="Si es una venta migrada, los cobros del sistema anterior no están pago por pago."
            />
          </div>
        ) : (
          <ul className="divide-y divide-stone-100">
            {pagos.map((p) => {
              const entro = p.estado === 'aprobado';
              return (
                <li key={p.payment_id} className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="whitespace-nowrap text-xs text-stone-500">
                      {dateLabel(p.fecha ?? p.created_at)}
                    </span>
                    <Badge className="bg-stone-100 text-stone-600">{p.tipo}</Badge>
                    <span className="text-xs text-stone-400">{p.forma}</span>
                    {p.de_comprador_anterior ? (
                      <Badge className="bg-amber-100 text-amber-800">
                        {p.buyer_full_name.split(' ')[0]} (antes)
                      </Badge>
                    ) : null}
                    <Badge
                      className={
                        entro ? 'bg-green-100 text-green-700' : 'bg-stone-200 text-stone-600'
                      }
                    >
                      {p.estado}
                    </Badge>
                    <span
                      className={`ml-auto font-semibold tabular-nums ${
                        entro ? 'text-stone-900' : 'text-stone-400 line-through'
                      }`}
                    >
                      {formatMoney(Number(p.amount_bob), 'BOB')}
                    </span>
                    {p.tiene_recibo ? (
                      <>
                        <a
                          href={`/admin/recibo/${p.payment_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-brand hover:underline"
                        >
                          Recibo
                        </a>
                        <EnviarReciboWhatsapp
                          paymentId={p.payment_id}
                          telefono={p.buyer_phone}
                          nombre={p.buyer_full_name}
                          trackingCode={l.tracking_code}
                          concepto={p.tipo}
                          monto={Number(p.amount_bob)}
                          moneda="BOB"
                        />
                      </>
                    ) : null}
                    {entro ? (
                      <button
                        type="button"
                        onClick={() =>
                          setAnular({
                            payment_id: p.payment_id,
                            monto_bob: Number(p.amount_bob),
                            etiqueta: `${p.tipo} · ${dateLabel(p.fecha ?? p.created_at)}`,
                          })
                        }
                        className="text-xs font-semibold text-red-700 hover:underline"
                      >
                        Anular
                      </button>
                    ) : null}
                  </div>
                  {p.motivo_rechazo ? (
                    <p className="mt-1 text-xs text-amber-700">{p.motivo_rechazo}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <p className="border-t border-stone-100 px-4 py-2.5 text-xs text-stone-400">
          Se listan también los intentos rechazados y cancelados: no suman al saldo, pero son la
          explicación cuando el comprador dice que ya pagó.
        </p>
      </section>

      <AnularPagoDialog pago={anular} onClose={() => setAnular(null)} onDone={() => void cargar()} />
    </div>
  );
}
