'use client';

// Perfil de cliente: una persona, todos sus lotes, toda su plata.
//
// Todo lo demás del panel gira alrededor de la venta; esta pantalla gira
// alrededor de la PERSONA, que es como llama la gente a la oficina: «soy
// Fulano, ¿cuánto debo?». El cliente se arma agrupando por carnet normalizado
// (v_clientes) — no hay tabla de clientes, y no hace falta: la llave ya existe.
//
// Sin filtro de urbanización a propósito: un cliente es de la EMPRESA. Sus
// lotes pueden estar repartidos en tres urbanizaciones y la pregunta «¿cuánto
// debe?» es una sola. El desglose por proyecto se ve en su actividad.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { formatMoney, waLink } from '@/lib/format';
import { Badge, EmptyState, Kpi, Spinner, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { IconWhatsapp } from '@/features/admin/ui/icons';
import { ExportButtons } from '@/features/admin/export/ExportButtons';
import { num as fnum, type Cell as XCell } from '@/features/admin/export';
import { dateLabel } from '@/features/admin/contabilidad/types';

interface Cliente {
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
}

interface Actividad {
  reservation_id: string;
  tracking_code: string;
  estado: string;
  proyecto: string;
  manzana: string | null;
  lote: string | null;
  price_agreed: number;
  created_at: string;
  fecha_confirmada: string | null;
  fecha_cancelada: string | null;
  cancel_reason: string | null;
  recibida_por_traspaso: boolean;
  cedida_por_traspaso: boolean;
  cedida_a_tracking: string | null;
  origen_label: string;
  pagado_total: number | null;
  saldo: number | null;
  con_plan: boolean | null;
}

interface Pago {
  payment_id: string;
  tracking_code: string;
  proyecto: string;
  tipo: string;
  forma: string;
  amount: number;
  currency: 'BOB' | 'USD';
  amount_bob: number;
  estado: string;
  fecha: string | null;
  created_at: string;
  tiene_recibo: boolean;
  motivo_rechazo: string | null;
}

const ESTADO_BADGE: Record<string, string> = {
  confirmada: 'bg-green-100 text-green-700',
  pendiente_pago: 'bg-amber-100 text-amber-800',
  en_verificacion: 'bg-amber-100 text-amber-800',
  rechazo_reintento: 'bg-amber-100 text-amber-800',
  expirada: 'bg-stone-200 text-stone-600',
  cancelada: 'bg-stone-200 text-stone-600',
};

const ESTADO_LABEL: Record<string, string> = {
  confirmada: 'Comprado',
  pendiente_pago: 'Reservado',
  en_verificacion: 'En verificación',
  rechazo_reintento: 'Reintento',
  expirada: 'Expirada',
  cancelada: 'Cancelada',
};

const PAGO_BADGE: Record<string, string> = {
  aprobado: 'bg-green-100 text-green-700',
  rechazado: 'bg-red-100 text-red-700',
  cancelado: 'bg-stone-200 text-stone-600',
};

type Filtro = 'todos' | 'con_saldo' | 'en_mora' | 'con_reservas' | 'varios_lotes';

const CHIPS: { id: Filtro; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'con_saldo', label: 'Con saldo' },
  { id: 'en_mora', label: 'En mora' },
  { id: 'con_reservas', label: 'Con reservas en curso' },
  { id: 'varios_lotes', label: 'Varios lotes' },
];

export default function ClientesClient({ abrirCi }: { abrirCi: string | null }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');

  const [abierto, setAbierto] = useState<string | null>(null);
  const [actividad, setActividad] = useState<Actividad[] | null>(null);
  const [pagos, setPagos] = useState<Pago[] | null>(null);
  const abiertoRef = useRef<string | null>(null);
  abiertoRef.current = abierto;
  const detailRef = useRef<HTMLTableRowElement | null>(null);
  const [scrollTo, setScrollTo] = useState<string | null>(abrirCi);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    // Paginado: son ~1.400 clientes migrados y PostgREST corta en 1.000.
    const todos: Cliente[] = [];
    for (let desde = 0; ; desde += 1000) {
      const { data } = await supabase
        .from('v_clientes')
        .select('*')
        .order('ultima_actividad', { ascending: false })
        .order('ci_norm')
        .range(desde, desde + 999);
      todos.push(...((data ?? []) as Cliente[]));
      if (!data || data.length < 1000) break;
    }
    setRows(todos);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const abrirPerfil = useCallback(
    async (ci: string) => {
      if (abiertoRef.current === ci) {
        setAbierto(null);
        return;
      }
      setAbierto(ci);
      setActividad(null);
      setPagos(null);
      const [a, p] = await Promise.all([
        supabase
          .from('v_cliente_actividad')
          .select('*')
          .eq('ci_norm', ci)
          .order('created_at', { ascending: false }),
        supabase
          .from('v_historial_pagos')
          .select('*')
          .eq('ci_norm', ci)
          .order('created_at', { ascending: false }),
      ]);
      if (abiertoRef.current !== ci) return;
      setActividad((a.data ?? []) as Actividad[]);
      setPagos((p.data ?? []) as unknown as Pago[]);
    },
    [supabase],
  );

  // Enlace profundo ?ci= — el perfil se abre solo al llegar desde otra pantalla.
  useEffect(() => {
    if (loading || !scrollTo) return;
    // El enlace puede traer el CI crudo (7896541-1E) o el normalizado: se
    // acepta cualquiera de los dos, porque quien enlaza no tiene por qué saber
    // cómo normaliza la base.
    const destino = rows.find((r) => r.ci_norm === scrollTo || r.buyer_ci === scrollTo);
    if (destino) {
      void abrirPerfil(destino.ci_norm);
    }
    setScrollTo(null);
  }, [loading, rows, scrollTo, abrirPerfil]);

  useEffect(() => {
    if (abierto && detailRef.current) {
      detailRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [abierto, actividad]);

  const totals = useMemo(
    () => ({
      clientes: rows.length,
      conSaldo: rows.filter((r) => Number(r.saldo_total) > 0).length,
      enMora: rows.filter((r) => Number(r.cuotas_vencidas) > 0).length,
      conReservas: rows.filter((r) => Number(r.lotes_reservados) > 0).length,
      pagado: rows.reduce((s, r) => s + Number(r.pagado_total), 0),
      saldo: rows.reduce((s, r) => s + Number(r.saldo_total), 0),
    }),
    [rows],
  );

  const visibles = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filtro === 'con_saldo' && !(Number(r.saldo_total) > 0)) return false;
      if (filtro === 'en_mora' && !(Number(r.cuotas_vencidas) > 0)) return false;
      if (filtro === 'con_reservas' && !(Number(r.lotes_reservados) > 0)) return false;
      if (filtro === 'varios_lotes' && !(Number(r.lotes_comprados) > 1)) return false;
      if (!q) return true;
      return (
        r.buyer_full_name.toLowerCase().includes(q) ||
        r.buyer_ci.toLowerCase().includes(q) ||
        (r.buyer_phone ?? '').includes(q) ||
        (r.buyer_email ?? '').toLowerCase().includes(q)
      );
    });
  }, [rows, query, filtro]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-lg font-bold text-stone-900">Clientes</h1>
        <p className="text-xs text-stone-500">
          Toda la empresa: un cliente puede tener lotes en varias urbanizaciones.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Clientes"
          value={String(totals.clientes)}
          hint={`${totals.conReservas} con reservas en curso — ver`}
          onClick={() => setFiltro('todos')}
        />
        <Kpi
          label="Nos han pagado"
          value={formatMoney(totals.pagado, 'BOB')}
          hint="todo lo aprobado, de todas sus compras"
          tone="good"
          onClick={() => setFiltro('todos')}
        />
        <Kpi
          label="Nos deben"
          value={formatMoney(totals.saldo, 'BOB')}
          hint={`${totals.conSaldo} cliente(s) con saldo — ver`}
          onClick={() => setFiltro('con_saldo')}
        />
        <Kpi
          label="En mora"
          value={String(totals.enMora)}
          hint="con cuotas vencidas — ver"
          tone={totals.enMora > 0 ? 'bad' : 'normal'}
          onClick={() => setFiltro('en_mora')}
        />
      </div>

      <section className="rounded-xl border border-stone-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 px-4 py-3">
          {CHIPS.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={filtro === c.id}
              onClick={() => setFiltro(c.id)}
              className={`cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filtro === c.id
                  ? 'bg-brand text-white'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              {c.label}
            </button>
          ))}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, CI, teléfono o correo"
            className={`${inputClass} ml-auto w-auto min-w-64`}
          />
          <ExportButtons
            disabled={!visibles.length}
            orientation="landscape"
            meta={{
              title: 'Clientes',
              subtitle: 'Terrenalv S.R.L. — todas las urbanizaciones',
              filename: `clientes-${new Date().toISOString().slice(0, 10)}`,
              footnote:
                'Pagado incluye lo abonado en el sistema anterior. Saldo y mora, de las ventas vivas.',
            }}
            columns={[
              { header: 'Cliente' },
              { header: 'CI' },
              { header: 'Teléfono' },
              { header: 'Comprados', align: 'right' },
              { header: 'Reservados', align: 'right' },
              { header: 'Pagado', align: 'right' },
              { header: 'Saldo', align: 'right' },
              { header: 'Cuotas vencidas', align: 'right' },
              { header: 'Última actividad' },
            ]}
            rows={() =>
              visibles.map((r) => [
                r.buyer_full_name,
                r.buyer_ci,
                r.buyer_phone,
                fnum(Number(r.lotes_comprados), 0),
                fnum(Number(r.lotes_reservados), 0),
                fnum(Number(r.pagado_total)),
                fnum(Number(r.saldo_total)),
                fnum(Number(r.cuotas_vencidas), 0),
                r.ultima_actividad ? dateLabel(r.ultima_actividad) : '—',
              ]) as XCell[][]
            }
          />
        </div>

        {visibles.length === 0 ? (
          <div className="px-4 py-8">
            <EmptyState
              title={rows.length ? 'Ningún cliente coincide' : 'Todavía no hay clientes'}
              hint={
                rows.length
                  ? 'Probá con otro filtro o limpiá la búsqueda.'
                  : 'Los clientes aparecen solos con la primera reserva o venta.'
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-200 text-sm">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50 text-left">
                  <th className="px-4 py-2 text-xs font-semibold text-stone-500">Cliente</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Comprados
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Reservados
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Pagado
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Saldo
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Mora</th>
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">Últ. actividad</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((r) => (
                  <Fragment key={r.ci_norm}>
                    <tr
                      onClick={() => void abrirPerfil(r.ci_norm)}
                      className={`cursor-pointer border-b border-stone-100 last:border-0 hover:bg-stone-50 ${
                        abierto === r.ci_norm ? 'bg-green-50/60' : ''
                      }`}
                    >
                      <td className="px-4 py-2">
                        <p className="font-medium text-stone-900">{r.buyer_full_name}</p>
                        <p className="text-xs text-stone-400">
                          CI {r.buyer_ci} · {r.buyer_phone}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.lotes_comprados}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {Number(r.lotes_reservados) > 0 ? (
                          <Badge className="bg-amber-100 text-amber-800">{r.lotes_reservados}</Badge>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-stone-600">
                        {formatMoney(Number(r.pagado_total), 'BOB')}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-semibold tabular-nums ${
                          Number(r.saldo_total) > 0 ? 'text-red-600' : 'text-stone-900'
                        }`}
                      >
                        {formatMoney(Number(r.saldo_total), 'BOB')}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {Number(r.cuotas_vencidas) > 0 ? (
                          <Badge className="bg-red-100 text-red-700">
                            {r.cuotas_vencidas} · {formatMoney(Number(r.monto_vencido), 'BOB')}
                          </Badge>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-stone-400">
                        {r.ultima_actividad ? dateLabel(r.ultima_actividad) : '—'}
                      </td>
                    </tr>

                    {abierto === r.ci_norm ? (
                      <tr ref={detailRef} className="border-b border-stone-100 bg-stone-50/70 last:border-0">
                        <td colSpan={7} className="px-4 py-4">
                          <div className="mb-3 flex flex-wrap items-center gap-3">
                            <div>
                              <p className="text-sm font-bold text-stone-900">{r.buyer_full_name}</p>
                              <p className="text-xs text-stone-500">
                                CI {r.buyer_ci} · {r.buyer_phone}
                                {r.buyer_email ? ` · ${r.buyer_email}` : ''}
                                {Number(r.proyectos) > 1
                                  ? ` · en ${r.proyectos} urbanizaciones`
                                  : ''}
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
                            {(r.traspasos_cedidos > 0 || r.traspasos_recibidos > 0) && (
                              <span className="text-xs text-stone-500">
                                {r.traspasos_recibidos > 0
                                  ? `${r.traspasos_recibidos} lote(s) recibidos por traspaso. `
                                  : ''}
                                {r.traspasos_cedidos > 0
                                  ? `${r.traspasos_cedidos} lote(s) cedidos.`
                                  : ''}
                              </span>
                            )}
                          </div>

                          <div className="grid gap-4 lg:grid-cols-2">
                            <div>
                              <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                                Sus lotes y reservas
                              </p>
                              {actividad === null ? (
                                <div className="mt-3">
                                  <Spinner />
                                </div>
                              ) : actividad.length === 0 ? (
                                <p className="mt-2 text-sm text-stone-500">Sin actividad.</p>
                              ) : (
                                <ul className="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
                                  {actividad.map((a) => (
                                    <li key={a.reservation_id} className="px-3 py-2 text-sm">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <Badge
                                          className={ESTADO_BADGE[a.estado] ?? 'bg-stone-100 text-stone-600'}
                                        >
                                          {ESTADO_LABEL[a.estado] ?? a.estado}
                                        </Badge>
                                        <span className="text-stone-800">
                                          Mz {a.manzana ?? '—'}, Lote {a.lote ?? '—'}
                                        </span>
                                        <span className="text-xs text-stone-400">{a.proyecto}</span>
                                        {a.estado === 'confirmada' ? (
                                          <Link
                                            href={`/admin/ventas?open=${a.reservation_id}`}
                                            className="ml-auto font-mono text-xs font-semibold text-brand hover:underline"
                                          >
                                            {a.tracking_code}
                                          </Link>
                                        ) : (
                                          <span className="ml-auto font-mono text-xs text-stone-400">
                                            {a.tracking_code}
                                          </span>
                                        )}
                                      </div>
                                      <p className="mt-0.5 text-xs text-stone-500">
                                        {a.origen_label} · {dateLabel(a.fecha_confirmada ?? a.created_at)}
                                        {a.estado === 'confirmada' && a.saldo !== null ? (
                                          <>
                                            {' '}
                                            · pagado {formatMoney(Number(a.pagado_total ?? 0), 'BOB')} ·{' '}
                                            <span
                                              className={
                                                Number(a.saldo) > 0 ? 'font-semibold text-red-600' : ''
                                              }
                                            >
                                              saldo {formatMoney(Number(a.saldo), 'BOB')}
                                            </span>
                                            {a.con_plan ? ' · con plan' : ''}
                                          </>
                                        ) : null}
                                        {a.cedida_por_traspaso
                                          ? ` · cedida (${a.cedida_a_tracking ?? '—'})`
                                          : ''}
                                        {a.recibida_por_traspaso ? ' · recibida por traspaso' : ''}
                                      </p>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>

                            <div>
                              <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                                Todos sus pagos
                              </p>
                              {pagos === null ? (
                                <div className="mt-3">
                                  <Spinner />
                                </div>
                              ) : pagos.length === 0 ? (
                                <p className="mt-2 text-sm text-stone-500">
                                  Sin pagos registrados acá
                                  {Number(r.pagado_total) > 0
                                    ? ' (lo pagado viene del sistema anterior)'
                                    : ''}
                                  .
                                </p>
                              ) : (
                                <ul className="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
                                  {pagos.map((p) => (
                                    <li
                                      key={p.payment_id}
                                      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
                                    >
                                      <span className="whitespace-nowrap text-xs text-stone-500">
                                        {dateLabel(p.fecha ?? p.created_at)}
                                      </span>
                                      <Badge className="bg-stone-100 text-stone-600">{p.tipo}</Badge>
                                      <span className="text-xs text-stone-400">{p.forma}</span>
                                      <span className="text-xs text-stone-400">{p.proyecto}</span>
                                      {p.estado !== 'aprobado' ? (
                                        <Badge
                                          className={PAGO_BADGE[p.estado] ?? 'bg-amber-100 text-amber-800'}
                                        >
                                          {p.estado}
                                        </Badge>
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
                          </div>

                          <div className="mt-3">
                            <button
                              type="button"
                              className={btnSecondary}
                              onClick={() => setAbierto(null)}
                            >
                              Cerrar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-400">
          Pagado suma todo lo aprobado de la persona — incluidas señas de reservas que después
          vencieron (esa plata entró igual) y lo abonado en el sistema anterior. Saldo y mora, de
          sus ventas vivas.
        </p>
      </section>
    </div>
  );
}
