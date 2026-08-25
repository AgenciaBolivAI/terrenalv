'use client';

// El historial completo de UN cliente, para embutirlo en cualquier pantalla.
//
// Cuando la oficina elige a una persona, deja de importarle el resto del
// mundo: quiere ver TODO lo de esa persona junto — lo que compró, lo que
// reservó y se le venció, lo que cedió, lo que recibió por traspaso, y cada
// peso que pagó con su recibo al lado.
//
// Cada movimiento se abre y muestra los pagos de SU lote siguiendo la cadena:
// si el lote le llegó por traspaso, los pagos del dueño anterior también son
// historia de ese lote, marcados con el nombre de quien los hizo — su recibo
// sigue siendo suyo.

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { formatMoney, waLink } from '@/lib/format';
import { Badge, EmptyState, Spinner, btnSecondary } from '@/features/admin/ui/bits';
import { IconWhatsapp } from '@/features/admin/ui/icons';
import { dateLabel } from '@/features/admin/contabilidad/types';

interface Resumen {
  ci_norm: string;
  buyer_full_name: string;
  buyer_ci: string;
  buyer_phone: string;
  buyer_email: string | null;
  reservas_totales: number;
  lotes_comprados: number;
  lotes_reservados: number;
  reservas_expiradas: number;
  reservas_canceladas: number;
  traspasos_cedidos: number;
  traspasos_recibidos: number;
  proyectos: number;
  pagado_total: number;
  saldo_total: number;
  con_plan: number;
  cuotas_vencidas: number;
  monto_vencido: number;
  primera_actividad: string;
  ultima_actividad: string | null;
  comisiones_pagadas: number;
  avisos_activos: number;
  vendidos_mercado: number;
  vendido_mercado_bob: number;
  nombres_distintos: number;
  nombres_vistos: string;
}

interface Movimiento {
  reservation_id: string;
  tracking_code: string;
  estado: string;
  proyecto: string;
  manzana: string | null;
  lote: string | null;
  area_m2: number | null;
  price_agreed: number;
  created_at: string;
  fecha_confirmada: string | null;
  fecha_cancelada: string | null;
  cancel_reason: string | null;
  origen_label: string;
  pagado_total: number | null;
  saldo: number | null;
  con_plan: boolean | null;
  recibida_por_traspaso: boolean;
  cedida_por_traspaso: boolean;
  cedida_a_tracking: string | null;
  cedida_a_comprador: string | null;
  traspaso_de_tracking: string | null;
  traspaso_de_comprador: string | null;
  comprada_en_mercado: boolean;
  precio_mercado: number | null;
  vendida_en_mercado: boolean;
}

interface PagoCadena {
  venta_id: string;
  payment_id: string;
  tipo: string;
  forma: string;
  amount: number;
  currency: 'BOB' | 'USD';
  amount_bob: number;
  estado: string;
  fecha: string | null;
  created_at: string;
  tiene_recibo: boolean;
  buyer_full_name: string;
  tracking_code: string;
  de_comprador_anterior: boolean;
}

const BADGE: Record<string, string> = {
  confirmada: 'bg-green-100 text-green-700',
  pendiente_pago: 'bg-amber-100 text-amber-800',
  en_verificacion: 'bg-amber-100 text-amber-800',
  rechazo_reintento: 'bg-amber-100 text-amber-800',
  expirada: 'bg-stone-200 text-stone-600',
  cancelada: 'bg-stone-200 text-stone-600',
};

/** Qué fue este movimiento, en las palabras del mostrador. */
function etiqueta(m: Movimiento): { texto: string; clase: string } {
  if (m.cedida_por_traspaso) {
    return m.vendida_en_mercado
      ? { texto: 'Vendido por el mercado', clase: 'bg-violet-100 text-violet-800' }
      : { texto: 'Cedido por traspaso', clase: 'bg-violet-100 text-violet-800' };
  }
  if (m.estado === 'confirmada' && m.recibida_por_traspaso) {
    return m.comprada_en_mercado
      ? { texto: 'Comprado en el mercado', clase: 'bg-green-100 text-green-700' }
      : { texto: 'Recibido por traspaso', clase: 'bg-green-100 text-green-700' };
  }
  if (m.estado === 'confirmada') return { texto: 'Comprado', clase: BADGE.confirmada };
  if (m.estado === 'expirada') return { texto: 'Reserva vencida', clase: BADGE.expirada };
  if (m.estado === 'cancelada') return { texto: 'Cancelado', clase: BADGE.cancelada };
  return { texto: 'Reservado', clase: BADGE.pendiente_pago };
}

export function HistorialCliente({ ci }: { ci: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [r, setR] = useState<Resumen | null>(null);
  const [movs, setMovs] = useState<Movimiento[]>([]);
  const [pagos, setPagos] = useState<PagoCadena[]>([]);
  const [cargado, setCargado] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const limpio = ci.replace(/,/g, '');
    const { data } = await supabase
      .from('v_clientes')
      .select('*')
      .or(`ci_norm.eq.${limpio},buyer_ci.eq.${limpio}`)
      .limit(1)
      .maybeSingle();
    const res = (data as Resumen | null) ?? null;
    setR(res);
    if (res) {
      const { data: act } = await supabase
        .from('v_cliente_actividad')
        .select('*')
        .eq('ci_norm', res.ci_norm)
        .order('created_at', { ascending: false });
      const lista = (act ?? []) as unknown as Movimiento[];
      setMovs(lista);
      if (lista.length > 0) {
        // Todos los pagos de todos sus lotes, cadena incluida, en una sola ida.
        const { data: pg } = await supabase
          .from('v_historial_pagos_cadena')
          .select('*')
          .in(
            'venta_id',
            lista.map((m) => m.reservation_id),
          )
          .order('created_at', { ascending: false });
        setPagos((pg ?? []) as unknown as PagoCadena[]);
      }
    }
    setCargado(true);
  }, [supabase, ci]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!cargado) {
    return (
      <div className="flex justify-center py-12">
        <Spinner label="Cargando el historial…" />
      </div>
    );
  }
  if (!r) {
    return (
      <EmptyState
        title="No encontramos a este cliente"
        hint={`Ningún perfil con el carnet ${ci}. Si su CI está escrito distinto en cada venta, corregilo y los perfiles se unen.`}
      />
    );
  }

  const recibosTotales = pagos.filter((p) => p.tiene_recibo).length;

  return (
    <div className="space-y-4">
      {/* ---- Quién es y cómo está ---- */}
      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <p className="text-base font-bold text-stone-900">{r.buyer_full_name}</p>
            <p className="text-xs text-stone-500">
              CI {r.buyer_ci} · {r.buyer_phone}
              {r.buyer_email ? ` · ${r.buyer_email}` : ''}
              {' · cliente desde '}
              {dateLabel(r.primera_actividad)}
            </p>
          </div>
          <a
            href={waLink(
              r.buyer_phone,
              `Hola ${r.buyer_full_name.split(' ')[0] ?? ''}, le escribimos de Terrenalv.`,
            )}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-green-700"
          >
            <IconWhatsapp className="h-4 w-4" /> WhatsApp
          </a>
          <Link
            href={`/admin/clientes?ci=${encodeURIComponent(r.ci_norm)}`}
            className={`${btnSecondary} ml-auto`}
          >
            Editar perfil
          </Link>
        </div>

        {Number(r.nombres_distintos) > 1 ? (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
            Este carnet aparece con nombres distintos ({r.nombres_vistos}). Un perfil es una
            persona: si son dos, alguien tecleó el mismo CI en las dos ventas.
          </p>
        ) : null}

        <div className="mt-3 grid grid-cols-2 gap-3 text-center sm:grid-cols-5">
          <div className="rounded-lg bg-stone-50 p-2.5">
            <p className="text-[11px] text-stone-500">Lotes hoy</p>
            <p className="text-lg font-bold tabular-nums">{r.lotes_comprados}</p>
          </div>
          <div className="rounded-lg bg-stone-50 p-2.5">
            <p className="text-[11px] text-stone-500">Movimientos</p>
            <p className="text-lg font-bold tabular-nums">{r.reservas_totales}</p>
          </div>
          <div className="rounded-lg bg-green-50 p-2.5">
            <p className="text-[11px] text-stone-500">Nos ha pagado</p>
            <p className="text-lg font-bold tabular-nums text-brand">
              {formatMoney(Number(r.pagado_total), 'BOB')}
            </p>
          </div>
          <div className="rounded-lg bg-stone-50 p-2.5">
            <p className="text-[11px] text-stone-500">Nos debe</p>
            <p
              className={`text-lg font-bold tabular-nums ${
                Number(r.saldo_total) > 0 ? 'text-red-600' : 'text-stone-900'
              }`}
            >
              {formatMoney(Number(r.saldo_total), 'BOB')}
            </p>
          </div>
          <div className="rounded-lg bg-stone-50 p-2.5">
            <p className="text-[11px] text-stone-500">Recibos</p>
            <p className="text-lg font-bold tabular-nums">{recibosTotales}</p>
          </div>
        </div>

        <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-stone-500">
          {Number(r.cuotas_vencidas) > 0 ? (
            <Badge className="bg-red-100 text-red-700">
              {r.cuotas_vencidas} cuota(s) vencida(s) ·{' '}
              {formatMoney(Number(r.monto_vencido), 'BOB')}
            </Badge>
          ) : (
            <Badge className="bg-green-100 text-green-700">Sin mora</Badge>
          )}
          {Number(r.con_plan) > 0 ? (
            <Badge className="bg-stone-100 text-stone-600">{r.con_plan} plan(es) de cuotas</Badge>
          ) : null}
          {Number(r.proyectos) > 1 ? (
            <Badge className="bg-stone-100 text-stone-600">
              en {r.proyectos} urbanizaciones
            </Badge>
          ) : null}
          {Number(r.traspasos_recibidos) > 0 ? (
            <span>{r.traspasos_recibidos} lote(s) recibidos por traspaso.</span>
          ) : null}
          {Number(r.traspasos_cedidos) > 0 ? <span>{r.traspasos_cedidos} cedidos.</span> : null}
          {Number(r.vendidos_mercado) > 0 ? (
            <span>
              Vendió {r.vendidos_mercado} por el mercado por{' '}
              {formatMoney(Number(r.vendido_mercado_bob), 'BOB')} y pagó{' '}
              {formatMoney(Number(r.comisiones_pagadas), 'BOB')} de comisión.
            </span>
          ) : null}
          {Number(r.avisos_activos) > 0 ? (
            <Badge className="bg-green-100 text-green-800">
              {r.avisos_activos} aviso(s) en el mercado
            </Badge>
          ) : null}
        </p>
      </section>

      {/* ---- Todo lo que pasó, en orden ---- */}
      <section className="rounded-xl border border-stone-200 bg-white">
        <p className="border-b border-stone-200 px-4 py-2.5 text-xs font-semibold tracking-wide text-stone-500 uppercase">
          Su historia con Terrenalv — {movs.length} movimiento(s)
        </p>
        {movs.length === 0 ? (
          <div className="px-4 py-8">
            <EmptyState title="Sin movimientos" />
          </div>
        ) : (
          <ul className="divide-y divide-stone-100">
            {movs.map((m) => {
              const et = etiqueta(m);
              const suyos = pagos.filter((p) => p.venta_id === m.reservation_id);
              const abierta = abierto === m.reservation_id;
              return (
                <li key={m.reservation_id}>
                  <button
                    type="button"
                    onClick={() => setAbierto(abierta ? null : m.reservation_id)}
                    className="w-full px-4 py-3 text-left hover:bg-stone-50"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={et.clase}>{et.texto}</Badge>
                      <span className="font-medium text-stone-900">
                        Mz {m.manzana ?? '—'}, Lote {m.lote ?? '—'}
                      </span>
                      <span className="text-xs text-stone-400">{m.proyecto}</span>
                      <span className="font-mono text-xs text-stone-400">{m.tracking_code}</span>
                      <span className="ml-auto text-xs text-stone-500">
                        {dateLabel(m.fecha_cancelada ?? m.fecha_confirmada ?? m.created_at)}
                      </span>
                      <span className="text-xs text-stone-300">{abierta ? '▲' : '▼'}</span>
                    </div>
                    <p className="mt-1 text-xs text-stone-500">
                      {m.origen_label} · precio {formatMoney(Number(m.price_agreed), 'BOB')}
                      {m.estado === 'confirmada' && m.saldo !== null ? (
                        <>
                          {' · pagado '}
                          {formatMoney(Number(m.pagado_total ?? 0), 'BOB')}
                          {' · '}
                          <span
                            className={Number(m.saldo) > 0 ? 'font-semibold text-red-600' : ''}
                          >
                            saldo {formatMoney(Number(m.saldo), 'BOB')}
                          </span>
                          {m.con_plan ? ' · con plan' : ''}
                        </>
                      ) : null}
                      {suyos.length > 0 ? ` · ${suyos.length} pago(s)` : ''}
                    </p>
                    {m.recibida_por_traspaso ? (
                      <p className="mt-0.5 text-xs text-stone-500">
                        Recibido de <strong>{m.traspaso_de_comprador ?? '—'}</strong> (
                        {m.traspaso_de_tracking ?? '—'})
                        {m.comprada_en_mercado && m.precio_mercado !== null
                          ? ` — pagó ${formatMoney(Number(m.precio_mercado), 'BOB')} por el mercado`
                          : ''}
                        .
                      </p>
                    ) : null}
                    {m.cedida_por_traspaso ? (
                      <p className="mt-0.5 text-xs text-stone-500">
                        Cedido a <strong>{m.cedida_a_comprador ?? '—'}</strong> (
                        {m.cedida_a_tracking ?? '—'}). Sus recibos siguen a su nombre.
                      </p>
                    ) : null}
                    {m.estado === 'cancelada' && !m.cedida_por_traspaso && m.cancel_reason ? (
                      <p className="mt-0.5 text-xs text-stone-500">{m.cancel_reason}</p>
                    ) : null}
                  </button>

                  {abierta ? (
                    <div className="border-t border-stone-100 bg-stone-50/70 px-4 py-3">
                      <div className="mb-2 flex flex-wrap gap-2">
                        {m.estado === 'confirmada' ? (
                          <Link
                            href={`/admin/ventas?open=${m.reservation_id}`}
                            className={btnSecondary}
                          >
                            Abrir la venta
                          </Link>
                        ) : (
                          <Link
                            href={`/admin/reservas?open=${m.reservation_id}`}
                            className={btnSecondary}
                          >
                            Abrir la reserva
                          </Link>
                        )}
                        {m.estado === 'confirmada' || m.cedida_por_traspaso ? (
                          <a
                            href={`/admin/contrato/${m.reservation_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={btnSecondary}
                          >
                            Contrato
                          </a>
                        ) : null}
                      </div>

                      <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                        Pagos y recibos de este lote
                      </p>
                      {suyos.length === 0 ? (
                        <p className="mt-1 text-sm text-stone-500">
                          Sin pagos registrados en este sistema para este lote.
                        </p>
                      ) : (
                        <ul className="mt-1.5 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
                          {suyos.map((p) => (
                            <li
                              key={p.payment_id}
                              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
                            >
                              <span className="whitespace-nowrap text-xs text-stone-500">
                                {dateLabel(p.fecha ?? p.created_at)}
                              </span>
                              <Badge className="bg-stone-100 text-stone-600">{p.tipo}</Badge>
                              <span className="text-xs text-stone-400">{p.forma}</span>
                              {p.de_comprador_anterior ? (
                                <span
                                  className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800"
                                  title={`Pago de ${p.buyer_full_name} bajo el contrato ${p.tracking_code}, antes del traspaso.`}
                                >
                                  {p.buyer_full_name.split(' ')[0]} (antes)
                                </span>
                              ) : null}
                              {p.estado !== 'aprobado' ? (
                                <Badge className="bg-amber-100 text-amber-800">{p.estado}</Badge>
                              ) : null}
                              <span
                                className={`ml-auto font-semibold tabular-nums ${
                                  p.estado === 'aprobado'
                                    ? 'text-stone-900'
                                    : 'text-stone-400 line-through'
                                }`}
                              >
                                {formatMoney(Number(p.amount), p.currency)}
                              </span>
                              {p.tiene_recibo ? (
                                <a
                                  href={`/admin/recibo/${p.payment_id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs font-semibold text-brand hover:underline"
                                >
                                  Recibo
                                </a>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-400">
          Están TODOS sus movimientos: lo que compró, lo que reservó y venció, lo que cedió y lo
          que recibió por traspaso. En un lote recibido por traspaso, los pagos del dueño anterior
          salen marcados con su nombre — su recibo sigue siendo suyo.
        </p>
      </section>
    </div>
  );
}
