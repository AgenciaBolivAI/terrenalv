'use client';

// La administración del mercado de traspasos.
//
// La vidriera pública muestra lotes sin vendedor; acá se ve TODO: quién vende,
// cuánto pide, quién preguntó y con qué teléfono. La oficina edita el aviso
// (precio, nota, comisión), lo pausa o lo cierra, marca consultas atendidas y,
// cuando las partes se ponen de acuerdo, salta directo a ejecutar el traspaso
// en Ventas — que es donde se cobra la comisión y se firman los libros.
//
// Sin filtro de urbanización a propósito: la vidriera es UNA para toda la
// empresa, y el mostrador la maneja entera.

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { formatMoney, waLink } from '@/lib/format';
import {
  Badge,
  EmptyState,
  Kpi,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputClass,
} from '@/features/admin/ui/bits';
import { IconWhatsapp } from '@/features/admin/ui/icons';
import { Dialog } from '@/features/admin/ui/dialog';
import { useToast } from '@/features/admin/ui/toast';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';

interface Aviso {
  listing_id: string;
  status: 'activa' | 'pausada' | 'cerrada';
  asking_price_bob: number;
  note: string | null;
  publicada: string;
  reservation_id: string;
  tracking_code: string;
  buyer_full_name: string;
  buyer_phone: string;
  proyecto: string;
  manzana: string | null;
  lote: string | null;
  saldo: number | null;
  consultas: number;
  consultas_sin_atender: number;
  fee_pct: number;
  sale_price_bob: number | null;
  fee_bob: number | null;
  fee_payment_id: string | null;
  closed_reason: string | null;
}

interface Consulta {
  id: string;
  nombre: string;
  telefono: string;
  mensaje: string | null;
  atendida: boolean;
  created_at: string;
}

type Filtro = 'todos' | 'vidriera' | 'pausadas' | 'vendidas' | 'cerradas';

const CHIPS: { id: Filtro; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'vidriera', label: 'En la vidriera' },
  { id: 'pausadas', label: 'Pausadas' },
  { id: 'vendidas', label: 'Vendidas por el mercado' },
  { id: 'cerradas', label: 'Cerradas' },
];

const ESTADO_BADGE: Record<Aviso['status'], string> = {
  activa: 'bg-green-100 text-green-800',
  pausada: 'bg-amber-100 text-amber-800',
  cerrada: 'bg-stone-200 text-stone-600',
};

export default function MercadoAdminClient() {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const [rows, setRows] = useState<Aviso[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [selected, setSelected] = useState<string | null>(null);
  const [consultas, setConsultas] = useState<Consulta[]>([]);
  const [editar, setEditar] = useState<Aviso | null>(null);

  const fetchAll = useCallback(async () => {
    const { data, error } = await supabase
      .from('v_mercado_admin')
      .select('*')
      .order('publicada', { ascending: false });
    if (!error) setRows((data ?? []) as Aviso[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const abrir = useCallback(
    async (a: Aviso) => {
      if (selected === a.listing_id) {
        setSelected(null);
        return;
      }
      setSelected(a.listing_id);
      const { data } = await supabase
        .from('market_inquiries')
        .select('*')
        .eq('listing_id', a.listing_id)
        .order('created_at', { ascending: false });
      setConsultas((data ?? []) as Consulta[]);
    },
    [supabase, selected],
  );

  async function cambiarEstado(a: Aviso, estado: 'activa' | 'pausada' | 'cerrada') {
    const { error } = await supabase.rpc('admin_mercado_editar', {
      p_listing_id: a.listing_id,
      p_status: estado,
    });
    if (error) {
      push(adminErrorCopy(error.message), 'error');
      return;
    }
    push(
      estado === 'activa'
        ? 'Aviso de vuelta en la vidriera.'
        : estado === 'pausada'
          ? 'Aviso pausado: no se ve en la vidriera.'
          : 'Aviso cerrado.',
      'success',
    );
    void fetchAll();
  }

  async function atender(c: Consulta, aviso: Aviso) {
    const { error } = await supabase.rpc('admin_mercado_atender', {
      p_inquiry_id: c.id,
      p_atendida: !c.atendida,
    });
    if (error) {
      push(adminErrorCopy(error.message), 'error');
      return;
    }
    setConsultas((prev) =>
      prev.map((x) => (x.id === c.id ? { ...x, atendida: !c.atendida } : x)),
    );
    setRows((prev) =>
      prev.map((x) =>
        x.listing_id === aviso.listing_id
          ? {
              ...x,
              consultas_sin_atender: x.consultas_sin_atender + (c.atendida ? 1 : -1),
            }
          : x,
      ),
    );
  }

  const visibles = useMemo(
    () =>
      rows.filter((r) => {
        if (filtro === 'vidriera') return r.status === 'activa';
        if (filtro === 'pausadas') return r.status === 'pausada';
        if (filtro === 'vendidas') return r.status === 'cerrada' && r.fee_payment_id !== null;
        if (filtro === 'cerradas') return r.status === 'cerrada';
        return true;
      }),
    [rows, filtro],
  );

  const totals = useMemo(
    () => ({
      vidriera: rows.filter((r) => r.status === 'activa').length,
      sinAtender: rows.reduce((s, r) => s + Number(r.consultas_sin_atender), 0),
      vendidas: rows.filter((r) => r.status === 'cerrada' && r.fee_payment_id !== null).length,
      comisiones: rows.reduce(
        (s, r) => s + (r.fee_payment_id !== null ? Number(r.fee_bob ?? 0) : 0),
        0,
      ),
    }),
    [rows],
  );

  if (loading) return <Spinner label="Cargando el mercado…" />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="En la vidriera"
          value={String(totals.vidriera)}
          hint="avisos que el público ve ahora"
          onClick={() => setFiltro('vidriera')}
        />
        <Kpi
          label="Consultas sin atender"
          value={String(totals.sinAtender)}
          tone={totals.sinAtender > 0 ? 'bad' : 'normal'}
          hint="interesados esperando una llamada"
          onClick={() => setFiltro('vidriera')}
        />
        <Kpi
          label="Vendidos por el mercado"
          value={String(totals.vendidas)}
          tone="good"
          hint="traspasos nacidos de un aviso"
          onClick={() => setFiltro('vendidas')}
        />
        <Kpi
          label="Comisiones cobradas"
          value={formatMoney(totals.comisiones, 'BOB')}
          tone="good"
          hint="ingreso propio por ventas del mercado"
          onClick={() => setFiltro('vendidas')}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {CHIPS.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setFiltro(c.id)}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${
              filtro === c.id
                ? 'bg-brand text-white'
                : 'border border-stone-300 bg-white text-stone-600 hover:bg-stone-50'
            }`}
          >
            {c.label}
          </button>
        ))}
        <a
          href="/mercado"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-sm font-semibold text-brand hover:underline"
        >
          Ver la vidriera pública ↗
        </a>
      </div>

      {visibles.length === 0 ? (
        <EmptyState
          title="No hay avisos con este filtro"
          hint="Los compradores publican desde su página de seguimiento; la oficina puede pedirles el código y publicar por ellos desde ahí también."
        />
      ) : (
        <section className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left">
                <th className="px-3 py-2 text-xs font-semibold text-stone-500">Lote</th>
                <th className="px-3 py-2 text-xs font-semibold text-stone-500">Vendedor</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Pide</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                  Saldo a asumir
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                  Comisión
                </th>
                <th className="px-3 py-2 text-center text-xs font-semibold text-stone-500">
                  Consultas
                </th>
                <th className="px-3 py-2 text-xs font-semibold text-stone-500">Estado</th>
                <th className="px-3 py-2 text-xs font-semibold text-stone-500">Publicado</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((r) => (
                <Fragment key={r.listing_id}>
                  <tr
                    className="cursor-pointer border-b border-stone-100 hover:bg-stone-50"
                    onClick={() => void abrir(r)}
                  >
                    <td className="px-3 py-2.5">
                      <p className="font-semibold text-stone-900">
                        Mz {r.manzana ?? '—'} · Lote {r.lote ?? '—'}
                      </p>
                      <p className="text-xs text-stone-500">{r.proyecto}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="text-stone-800">{r.buyer_full_name}</p>
                      <p className="font-mono text-xs text-stone-400">{r.tracking_code}</p>
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                      {formatMoney(Number(r.asking_price_bob), 'BOB')}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-stone-600">
                      {r.saldo !== null ? formatMoney(Number(r.saldo), 'BOB') : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-stone-600">
                      {r.fee_payment_id !== null
                        ? formatMoney(Number(r.fee_bob ?? 0), 'BOB')
                        : `${Number(r.fee_pct)}%`}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="tabular-nums">{r.consultas}</span>
                      {Number(r.consultas_sin_atender) > 0 ? (
                        <Badge className="ml-1.5 bg-red-100 text-red-700">
                          {r.consultas_sin_atender} sin atender
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge className={ESTADO_BADGE[r.status]}>{r.status}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-stone-500">{r.publicada}</td>
                  </tr>
                  {selected === r.listing_id ? (
                    <tr className="border-b border-stone-200 bg-stone-50/60">
                      <td colSpan={8} className="px-4 py-4">
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div className="space-y-3">
                            {r.note ? (
                              <p className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700">
                                «{r.note}»
                              </p>
                            ) : null}
                            {r.status === 'cerrada' ? (
                              <p className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs text-stone-600">
                                {r.closed_reason ?? 'Cerrada.'}
                                {r.fee_payment_id !== null ? (
                                  <>
                                    {' '}
                                    Se vendió en{' '}
                                    <strong>
                                      {formatMoney(Number(r.sale_price_bob ?? 0), 'BOB')}
                                    </strong>{' '}
                                    y la comisión del {Number(r.fee_pct)}% fue{' '}
                                    <strong>{formatMoney(Number(r.fee_bob ?? 0), 'BOB')}</strong>
                                    {' — '}
                                    <Link
                                      href={`/admin/recibo/${r.fee_payment_id}`}
                                      className="font-semibold text-brand hover:underline"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      ver recibo
                                    </Link>
                                    .
                                  </>
                                ) : null}
                              </p>
                            ) : (
                              <p className="text-xs text-stone-500">
                                Si se vende por el mercado, la comisión es el{' '}
                                <strong>{Number(r.fee_pct)}%</strong> del precio de venta y se
                                cobra al ejecutar el traspaso. Un traspaso sin aviso no paga
                                comisión.
                              </p>
                            )}
                            <div className="flex flex-wrap gap-2">
                              <Link
                                href={`/admin/ventas?open=${r.reservation_id}`}
                                className={btnPrimary}
                                onClick={(e) => e.stopPropagation()}
                              >
                                Ejecutar traspaso
                              </Link>
                              <button
                                type="button"
                                className={btnSecondary}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditar(r);
                                }}
                              >
                                Editar aviso
                              </button>
                              {r.status === 'activa' ? (
                                <button
                                  type="button"
                                  className={btnSecondary}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void cambiarEstado(r, 'pausada');
                                  }}
                                >
                                  Pausar
                                </button>
                              ) : null}
                              {r.status === 'pausada' ? (
                                <button
                                  type="button"
                                  className={btnSecondary}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void cambiarEstado(r, 'activa');
                                  }}
                                >
                                  Reactivar
                                </button>
                              ) : null}
                              {r.status !== 'cerrada' ? (
                                <button
                                  type="button"
                                  className={btnSecondary}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void cambiarEstado(r, 'cerrada');
                                  }}
                                >
                                  Cerrar aviso
                                </button>
                              ) : null}
                            </div>
                          </div>
                          <div>
                            <p className="mb-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">
                              Consultas de interesados
                            </p>
                            {consultas.length === 0 ? (
                              <p className="text-sm text-stone-500">Nadie preguntó todavía.</p>
                            ) : (
                              <ul className="space-y-2">
                                {consultas.map((c) => (
                                  <li
                                    key={c.id}
                                    className="rounded-lg border border-stone-200 bg-white px-3 py-2"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="text-sm font-semibold text-stone-900">
                                        {c.nombre}
                                      </p>
                                      <div className="flex items-center gap-2">
                                        <a
                                          href={waLink(
                                            c.telefono,
                                            `Hola ${c.nombre.split(' ')[0] ?? ''}, le escribimos de Terrenalv por su consulta del lote.`,
                                          )}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-brand"
                                          title="Escribir por WhatsApp"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <IconWhatsapp className="h-4 w-4" />
                                        </a>
                                        <button
                                          type="button"
                                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                                            c.atendida
                                              ? 'bg-green-100 text-green-800'
                                              : 'bg-amber-100 text-amber-800'
                                          }`}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void atender(c, r);
                                          }}
                                        >
                                          {c.atendida ? 'Atendida ✓' : 'Marcar atendida'}
                                        </button>
                                      </div>
                                    </div>
                                    <p className="text-xs text-stone-500">
                                      {c.telefono} ·{' '}
                                      {new Date(c.created_at).toLocaleDateString('es-BO')}
                                    </p>
                                    {c.mensaje ? (
                                      <p className="mt-1 text-sm text-stone-700">{c.mensaje}</p>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {editar ? (
        <EditarAvisoDialog
          aviso={editar}
          onClose={() => setEditar(null)}
          onSaved={() => {
            setEditar(null);
            void fetchAll();
          }}
        />
      ) : null}
    </div>
  );
}

/* ========================================================================== */

/** Editar un aviso: precio pedido, nota y — caso por caso — la comisión. */
function EditarAvisoDialog({
  aviso,
  onClose,
  onSaved,
}: {
  aviso: Aviso;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const [pide, setPide] = useState(String(aviso.asking_price_bob));
  const [nota, setNota] = useState(aviso.note ?? '');
  const [pct, setPct] = useState(String(aviso.fee_pct));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    if (!(Number(pide) > 0)) {
      setError('El precio pedido debe ser mayor a cero.');
      return;
    }
    const f = Number(pct);
    if (!(f >= 0 && f <= 100)) {
      setError('La comisión es un porcentaje entre 0 y 100.');
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.rpc('admin_mercado_editar', {
      p_listing_id: aviso.listing_id,
      p_asking: Number(pide),
      p_note: nota,
      p_fee_pct: f,
    });
    setBusy(false);
    if (err) {
      setError(adminErrorCopy(err.message));
      return;
    }
    push('Aviso actualizado.', 'success');
    onSaved();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Editar aviso — Mz ${aviso.manzana ?? '—'}, Lote ${aviso.lote ?? '—'}`}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Precio pedido (Bs)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={pide}
              onChange={(e) => setPide(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">Comisión (%)</label>
            <input
              type="number"
              min={0}
              max={100}
              step="0.5"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
        <textarea
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          rows={2}
          placeholder="Nota del aviso (la ve el público)"
          className={inputClass}
        />
        <p className="text-xs text-stone-500">
          Con {pct || '0'}% y un precio de {formatMoney(Number(pide) || 0, 'BOB')}, la comisión al
          venderse sería{' '}
          <strong className="tabular-nums">
            {formatMoney(
              Math.round((Number(pide) || 0) * (Number(pct) || 0)) / 100,
              'BOB',
            )}
          </strong>
          .
        </p>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Volver
        </button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void guardar()}>
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </Dialog>
  );
}
