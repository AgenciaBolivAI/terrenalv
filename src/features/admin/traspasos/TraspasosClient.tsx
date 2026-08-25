'use client';

// El registro de traspasos: cada lote que cambió de manos, con su historia.
//
// Terrenalv es dueña del lote hasta que se termina de pagar, así que un
// traspaso no es un cambio de nombre: es un hecho comercial con responsable.
// Esta pantalla contesta las preguntas que se hacen después, cuando alguien
// reclama: cuándo fue, qué lote, quién cedió, quién recibió, cuánta plata
// viajó, qué empleado lo firmó y si nació de un acuerdo en el mercado (con su
// comisión) o de un arreglo directo en el mostrador.

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { formatMoney, waLink } from '@/lib/format';
import { Badge, EmptyState, Kpi, Spinner, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { IconWhatsapp } from '@/features/admin/ui/icons';
import { ExportButtons } from '@/features/admin/export/ExportButtons';
import { num as fnum, type Cell as XCell } from '@/features/admin/export';
import { dateLabel } from '@/features/admin/contabilidad/types';
import { FichaClienteDialog } from '@/features/admin/clientes/FichaClienteDialog';

interface Traspaso {
  reservation_id: string;
  tracking_code: string;
  fecha: string;
  confirmed_at: string;
  proyecto: string;
  project_id: string;
  manzana: string | null;
  lote: string | null;
  area_m2: number | null;
  cedente: string;
  cedente_ci: string | null;
  cedente_tracking: string | null;
  cedente_reservation: string | null;
  comprador: string;
  comprador_ci: string;
  comprador_telefono: string;
  pagado_arrastrado: number;
  saldo_arrastrado: number;
  precio_lote: number;
  saldo_hoy: number | null;
  pagado_hoy: number | null;
  por_mercado: boolean;
  precio_pactado: number | null;
  comision_pct: number | null;
  comision_bob: number | null;
  comision_recibo: string | null;
  empleado: string | null;
  empleado_rol: string | null;
  motivo: string | null;
  estado_actual: string;
  con_plan: boolean;
}

type Filtro = 'todos' | 'mercado' | 'oficina' | 'con_saldo';

const CHIPS: { id: Filtro; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'mercado', label: 'Por el mercado' },
  { id: 'oficina', label: 'Directos en oficina' },
  { id: 'con_saldo', label: 'Con saldo pendiente' },
];

export default function TraspasosClient() {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Traspaso[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [query, setQuery] = useState('');
  const [abierto, setAbierto] = useState<string | null>(null);
  const [ficha, setFicha] = useState<{ ci: string; nombre: string } | null>(null);

  const cargar = useCallback(async () => {
    const { data, error } = await supabase
      .from('v_traspasos')
      .select('*')
      .order('confirmed_at', { ascending: false });
    if (error) setErrorCarga(error.message);
    else {
      setErrorCarga(null);
      setRows((data ?? []) as unknown as Traspaso[]);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const visibles = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filtro === 'mercado' && !r.por_mercado) return false;
      if (filtro === 'oficina' && r.por_mercado) return false;
      if (filtro === 'con_saldo' && !(Number(r.saldo_hoy ?? 0) > 0)) return false;
      if (!q) return true;
      return (
        r.cedente.toLowerCase().includes(q) ||
        r.comprador.toLowerCase().includes(q) ||
        r.tracking_code.toLowerCase().includes(q) ||
        (r.cedente_tracking ?? '').toLowerCase().includes(q) ||
        (r.empleado ?? '').toLowerCase().includes(q)
      );
    });
  }, [rows, query, filtro]);

  const totals = useMemo(
    () => ({
      total: rows.length,
      mercado: rows.filter((r) => r.por_mercado).length,
      arrastrado: rows.reduce((s, r) => s + Number(r.pagado_arrastrado ?? 0), 0),
      comisiones: rows.reduce((s, r) => s + Number(r.comision_bob ?? 0), 0),
    }),
    [rows],
  );

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
        <h1 className="text-lg font-bold text-stone-900">Traspasos</h1>
        <p className="text-xs text-stone-500">
          Cada lote que cambió de manos, con quién lo cedió, quién lo recibió y quién lo firmó.
        </p>
      </div>

      {errorCarga ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          No se pudo cargar el registro: {errorCarga}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Traspasos"
          value={String(totals.total)}
          hint="lotes que cambiaron de manos"
          onClick={() => setFiltro('todos')}
        />
        <Kpi
          label="Por el mercado"
          value={String(totals.mercado)}
          hint={`${totals.total - totals.mercado} directos en oficina — ver`}
          onClick={() => setFiltro('mercado')}
        />
        <Kpi
          label="Plata arrastrada"
          value={formatMoney(totals.arrastrado, 'BOB')}
          hint="pagos que pasaron al comprador nuevo"
          onClick={() => setFiltro('todos')}
        />
        <Kpi
          label="Comisiones cobradas"
          value={formatMoney(totals.comisiones, 'BOB')}
          tone="good"
          hint="ingreso propio por ventas del mercado"
          onClick={() => setFiltro('mercado')}
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
            placeholder="Buscar por comprador, cedente, código o empleado"
            className={`${inputClass} ml-auto w-auto min-w-64`}
          />
          <ExportButtons
            disabled={!visibles.length}
            orientation="landscape"
            meta={{
              title: 'Traspasos de lote',
              subtitle: 'Terrenalv S.R.L. — todas las urbanizaciones',
              filename: `traspasos-${new Date().toISOString().slice(0, 10)}`,
              footnote:
                'Arrastrado: lo pagado por el comprador anterior que quedó a favor del nuevo. La comisión solo existe cuando la venta se pactó por el mercado.',
            }}
            columns={[
              { header: 'Fecha' },
              { header: 'Urbanización' },
              { header: 'Lote' },
              { header: 'Cedió' },
              { header: 'Recibió' },
              { header: 'Arrastrado', align: 'right' },
              { header: 'Saldo asumido', align: 'right' },
              { header: 'Vía' },
              { header: 'Precio pactado', align: 'right' },
              { header: 'Comisión', align: 'right' },
              { header: 'Firmó' },
            ]}
            rows={() =>
              visibles.map((r) => [
                dateLabel(r.fecha),
                r.proyecto,
                `Mz ${r.manzana ?? '—'} L ${r.lote ?? '—'}`,
                r.cedente,
                r.comprador,
                fnum(Number(r.pagado_arrastrado ?? 0)),
                fnum(Number(r.saldo_arrastrado ?? 0)),
                r.por_mercado ? 'Mercado' : 'Oficina',
                r.precio_pactado != null ? fnum(Number(r.precio_pactado)) : '—',
                r.comision_bob != null ? fnum(Number(r.comision_bob)) : '—',
                r.empleado ?? '—',
              ]) as XCell[][]
            }
          />
        </div>

        {visibles.length === 0 ? (
          <div className="px-4 py-8">
            <EmptyState
              title={rows.length ? 'Ningún traspaso coincide' : 'Todavía no hay traspasos'}
              hint={
                rows.length
                  ? 'Probá con otro filtro o limpiá la búsqueda.'
                  : 'Un traspaso se registra desde Ventas → Traspasar, o al cerrar un acuerdo del mercado.'
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50 text-left">
                  <th className="px-4 py-2 text-xs font-semibold text-stone-500">Fecha</th>
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">Lote</th>
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">Cedió</th>
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">Recibió</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Arrastrado
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Saldo asumido
                  </th>
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">Vía</th>
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">Firmó</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((r) => (
                  <Fragment key={r.reservation_id}>
                    <tr
                      onClick={() =>
                        setAbierto(abierto === r.reservation_id ? null : r.reservation_id)
                      }
                      className={`cursor-pointer border-b border-stone-100 last:border-0 hover:bg-stone-50 ${
                        abierto === r.reservation_id ? 'bg-green-50/60' : ''
                      }`}
                    >
                      <td className="px-4 py-2 text-xs text-stone-500">{dateLabel(r.fecha)}</td>
                      <td className="px-3 py-2">
                        <p className="font-medium text-stone-900">
                          Mz {r.manzana ?? '—'}, Lote {r.lote ?? '—'}
                        </p>
                        <p className="text-xs text-stone-400">{r.proyecto}</p>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="text-left text-stone-800 hover:text-brand hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (r.cedente_ci) setFicha({ ci: r.cedente_ci, nombre: r.cedente });
                          }}
                        >
                          {r.cedente}
                        </button>
                        <p className="font-mono text-xs text-stone-400">
                          {r.cedente_tracking ?? '—'}
                        </p>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="text-left text-stone-800 hover:text-brand hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setFicha({ ci: r.comprador_ci, nombre: r.comprador });
                          }}
                        >
                          {r.comprador}
                        </button>
                        <p className="font-mono text-xs text-stone-400">{r.tracking_code}</p>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-brand">
                        {formatMoney(Number(r.pagado_arrastrado ?? 0), 'BOB')}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatMoney(Number(r.saldo_arrastrado ?? 0), 'BOB')}
                      </td>
                      <td className="px-3 py-2">
                        {r.por_mercado ? (
                          <Badge className="bg-green-100 text-green-800">Mercado</Badge>
                        ) : (
                          <Badge className="bg-stone-100 text-stone-600">Oficina</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-stone-500">{r.empleado ?? '—'}</td>
                    </tr>

                    {abierto === r.reservation_id ? (
                      <tr className="border-b border-stone-100 bg-stone-50/70 last:border-0">
                        <td colSpan={8} className="px-4 py-4">
                          <div className="grid gap-4 lg:grid-cols-2">
                            <div className="space-y-2 text-sm">
                              <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                                Cómo pasó
                              </p>
                              <p className="text-stone-700">
                                El {dateLabel(r.fecha)},{' '}
                                <strong>{r.cedente}</strong>
                                {r.cedente_ci ? ` (CI ${r.cedente_ci})` : ''} cedió su compra del
                                lote {r.lote ?? '—'} de la manzana {r.manzana ?? '—'} a{' '}
                                <strong>{r.comprador}</strong> (CI {r.comprador_ci}).
                              </p>
                              <p className="text-stone-700">
                                Se arrastraron{' '}
                                <strong>
                                  {formatMoney(Number(r.pagado_arrastrado ?? 0), 'BOB')}
                                </strong>{' '}
                                ya pagados y el comprador nuevo asumió un saldo de{' '}
                                <strong>
                                  {formatMoney(Number(r.saldo_arrastrado ?? 0), 'BOB')}
                                </strong>{' '}
                                sobre un lote de {formatMoney(Number(r.precio_lote), 'BOB')}.
                              </p>
                              {r.por_mercado ? (
                                <p className="rounded-lg border border-green-200 bg-green-50 p-2.5 text-stone-700">
                                  Acordado <strong>por el mercado</strong> de traspasos: precio
                                  pactado{' '}
                                  <strong>
                                    {formatMoney(Number(r.precio_pactado ?? 0), 'BOB')}
                                  </strong>{' '}
                                  y comisión del {Number(r.comision_pct ?? 0)}% —{' '}
                                  <strong>{formatMoney(Number(r.comision_bob ?? 0), 'BOB')}</strong>
                                  {r.comision_recibo ? (
                                    <>
                                      {' · '}
                                      <a
                                        href={`/admin/recibo/${r.comision_recibo}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="font-semibold text-brand hover:underline"
                                      >
                                        recibo de la comisión
                                      </a>
                                    </>
                                  ) : null}
                                  .
                                </p>
                              ) : (
                                <p className="rounded-lg border border-stone-200 bg-white p-2.5 text-stone-600">
                                  Traspaso <strong>directo en oficina</strong>, sin publicación en
                                  el mercado: no paga comisión.
                                </p>
                              )}
                              <p className="text-xs text-stone-500">
                                Firmado por <strong>{r.empleado ?? '—'}</strong>
                                {r.empleado_rol ? ` (${r.empleado_rol})` : ''} en el mostrador.
                              </p>
                              {r.motivo ? (
                                <p className="text-xs text-stone-500">Motivo: «{r.motivo}»</p>
                              ) : null}
                            </div>

                            <div className="space-y-2">
                              <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                                Cómo está hoy
                              </p>
                              <div className="grid grid-cols-3 gap-2 rounded-lg border border-stone-200 bg-white p-3 text-center text-sm">
                                <div>
                                  <p className="text-xs text-stone-500">Pagado hoy</p>
                                  <p className="font-bold tabular-nums text-brand">
                                    {formatMoney(Number(r.pagado_hoy ?? 0), 'BOB')}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs text-stone-500">Saldo hoy</p>
                                  <p
                                    className={`font-bold tabular-nums ${
                                      Number(r.saldo_hoy ?? 0) > 0
                                        ? 'text-red-600'
                                        : 'text-stone-900'
                                    }`}
                                  >
                                    {formatMoney(Number(r.saldo_hoy ?? 0), 'BOB')}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs text-stone-500">Plan</p>
                                  <p className="font-bold">{r.con_plan ? 'Sí' : 'No'}</p>
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Link
                                  href={`/admin/ventas?open=${r.reservation_id}`}
                                  className={btnSecondary}
                                >
                                  Abrir la venta
                                </Link>
                                <a
                                  href={`/admin/contrato/${r.reservation_id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={btnSecondary}
                                >
                                  Contrato del traspaso
                                </a>
                                {r.cedente_reservation ? (
                                  <a
                                    href={`/admin/contrato/${r.cedente_reservation}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={btnSecondary}
                                  >
                                    Contrato anulado del cedente
                                  </a>
                                ) : null}
                                <a
                                  href={waLink(
                                    r.comprador_telefono,
                                    `Hola ${r.comprador.split(' ')[0] ?? ''}, le escribimos de Terrenalv por su lote ${r.tracking_code}.`,
                                  )}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={btnSecondary}
                                >
                                  <IconWhatsapp className="h-4 w-4" /> Comprador
                                </a>
                              </div>
                            </div>
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
          «Arrastrado» es lo que el comprador anterior había pagado y quedó a favor del nuevo; sus
          recibos siguen a nombre de quien los hizo. La comisión solo existe cuando la venta se
          pactó por el mercado.
        </p>
      </section>

      {ficha ? (
        <FichaClienteDialog ci={ficha.ci} nombre={ficha.nombre} onClose={() => setFicha(null)} />
      ) : null}
    </div>
  );
}
