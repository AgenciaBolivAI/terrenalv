'use client';

// EL REGISTRO DE COMPROBANTES — todos, no solo los manuales.
//
// Lo que estaba roto: la pantalla «Comprobantes» listaba únicamente los
// asientos que alguien escribe a mano, y los egresos vivían en su propia
// pestaña con un número armado a partir del uuid. Para la contadora eran dos
// mundos sin puente: «no hay una conexión entre los egresos y los
// comprobantes registrados».
//
// Ahora hay UN registro. Sale de `v_comprobantes`, que se arma desde el
// propio libro diario agrupando por número de comprobante, así que no puede
// discrepar del libro: si un movimiento está asentado, su comprobante está
// acá, con el mismo número y el mismo importe. Y cada fila abre su documento
// —el comprobante de egreso, el recibo del cobro, el estado de cuenta de la
// venta— que es lo que se archiva y se firma.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/format';
import { Badge, Spinner, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { ExportButtons } from '@/features/admin/export/ExportButtons';
import { num, type Cell } from '@/features/admin/export';
import { dateLabel } from './types';

export interface ComprobanteRegistro {
  project_id: string;
  proyecto: string;
  numero: string;
  origen:
    | 'venta'
    | 'pago'
    | 'egreso'
    | 'terreno'
    | 'comprobante'
    | 'activo'
    | 'fondo'
    | 'pago_proveedor';
  origen_id: string;
  tipo: string;
  fecha: string;
  glosa: string;
  lineas: number;
  debe: number;
  haber: number;
  diferencia: number;
  registrado_en: string | null;
  modificado_en: string | null;
  usuario: string | null;
  moneda: string | null;
  tipo_cambio: number | null;
  centro_costo: string | null;
  cliente: string | null;
  es_manual: boolean;
}

const COLOR_TIPO: Record<ComprobanteRegistro['origen'], string> = {
  comprobante: 'bg-violet-100 text-violet-800',
  egreso: 'bg-amber-100 text-amber-800',
  venta: 'bg-green-100 text-green-800',
  pago: 'bg-sky-100 text-sky-800',
  terreno: 'bg-stone-200 text-stone-700',
  activo: 'bg-indigo-100 text-indigo-800',
  fondo: 'bg-teal-100 text-teal-800',
  pago_proveedor: 'bg-rose-100 text-rose-800',
};

/** Dónde vive el papel de cada comprobante. */
function documento(c: ComprobanteRegistro): string {
  switch (c.origen) {
    case 'egreso':
      return `/admin/egreso/${c.origen_id}`;
    case 'pago':
      return `/admin/recibo/${c.origen_id}`;
    case 'venta':
      return `/admin/plan/${c.origen_id}`;
    default:
      // El resto (activo fijo, fondo a rendir, pago a proveedor, compra de
      // terreno, asiento manual) no tiene un documento propio: el asiento
      // mismo ES el papel, y se imprime desde /admin/comprobante. Va por
      // número y no por uuid porque el número es lo que se archiva.
      return `/admin/comprobante/${encodeURIComponent(c.numero)}`;
  }
}

function fechaHora(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-BO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/La_Paz',
  });
}

export default function RegistroComprobantes({
  projectId,
  projectName,
}: {
  /** null = todas las urbanizaciones. */
  projectId: string | null;
  projectName: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<ComprobanteRegistro[] | null>(null);
  const [tipo, setTipo] = useState<'' | ComprobanteRegistro['origen']>('');
  const [busca, setBusca] = useState('');

  const load = useCallback(async () => {
    setRows(null);
    let q = supabase.from('v_comprobantes').select('*');
    if (projectId !== null) q = q.eq('project_id', projectId);
    const { data } = await q.order('fecha', { ascending: false }).limit(2000);
    setRows((data ?? []) as unknown as ComprobanteRegistro[]);
  }, [supabase, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibles = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (rows ?? []).filter(
      (c) =>
        (!tipo || c.origen === tipo) &&
        (!t ||
          c.numero.toLowerCase().includes(t) ||
          c.glosa.toLowerCase().includes(t) ||
          (c.cliente ?? '').toLowerCase().includes(t)),
    );
  }, [rows, tipo, busca]);

  const porTipo = useMemo(() => {
    const m = new Map<ComprobanteRegistro['origen'], { n: number; label: string }>();
    for (const c of rows ?? []) {
      const e = m.get(c.origen) ?? { n: 0, label: c.tipo };
      e.n += 1;
      m.set(c.origen, e);
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [rows]);

  const totalDebe = visibles.reduce((s, c) => s + Number(c.debe), 0);
  const descuadrados = visibles.filter((c) => Number(c.diferencia) !== 0).length;

  return (
    <section className="rounded-xl border border-stone-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 px-4 py-3">
        <div>
          <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
            Registro de comprobantes
          </h2>
          <p className="mt-0.5 text-xs text-stone-500">
            Todo lo que está asentado en el libro, con su número y su documento: los egresos, los
            cobros, las ventas y los asientos que se cargan a mano.
          </p>
        </div>
        <div className="ml-auto">
          <ExportButtons
            disabled={!visibles.length}
            orientation="landscape"
            meta={{
              title: 'Registro de Comprobantes',
              subtitle: projectName,
              filename: `registro-comprobantes-${new Date().toISOString().slice(0, 10)}`,
              footnote: 'Sale del libro diario: el registro y el libro dicen siempre lo mismo.',
            }}
            columns={[
              { header: 'Número' },
              { header: 'Fecha' },
              { header: 'Tipo' },
              { header: 'Glosa' },
              { header: 'Debe', align: 'right' },
              { header: 'Haber', align: 'right' },
              { header: 'Registrado' },
              { header: 'Usuario' },
            ]}
            rows={() =>
              visibles.map((c) => [
                c.numero,
                dateLabel(c.fecha),
                c.tipo,
                c.glosa,
                num(Number(c.debe)),
                num(Number(c.haber)),
                fechaHora(c.registrado_en),
                c.usuario ?? '—',
              ]) as Cell[][]
            }
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-stone-100 px-4 py-2.5">
        <button
          type="button"
          onClick={() => setTipo('')}
          className={`cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            tipo === '' ? 'bg-brand text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
          }`}
        >
          Todos ({rows?.length ?? 0})
        </button>
        {porTipo.map(([origen, { n, label }]) => (
          <button
            key={origen}
            type="button"
            onClick={() => setTipo(tipo === origen ? '' : origen)}
            className={`cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              tipo === origen ? 'bg-brand text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            {label} ({n})
          </button>
        ))}
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Número, glosa o cliente"
          className={`${inputClass} ml-auto w-56`}
          aria-label="Buscar comprobante"
        />
      </div>

      {rows === null ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : !visibles.length ? (
        <p className="py-10 text-center text-sm text-stone-400">
          {rows.length
            ? 'Ningún comprobante coincide con el filtro.'
            : 'Todavía no hay nada asentado en el libro.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-250 text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50 text-left">
                <th className="px-4 py-2 text-xs font-semibold text-stone-500">Número</th>
                <th className="px-3 py-2 text-xs font-semibold text-stone-500">Fecha</th>
                <th className="px-3 py-2 text-xs font-semibold text-stone-500">Tipo</th>
                <th className="px-3 py-2 text-xs font-semibold text-stone-500">Glosa</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Debe</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Haber</th>
                <th className="px-3 py-2 text-xs font-semibold text-stone-500">Registrado</th>
                <th className="px-3 py-2 text-xs font-semibold text-stone-500">Usuario</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {visibles.map((c) => {
                const doc = documento(c);
                return (
                  <tr
                    key={`${c.origen}-${c.origen_id}-${c.numero}`}
                    className="border-b border-stone-100 last:border-0 hover:bg-stone-50"
                  >
                    <td className="px-4 py-1.5 font-mono text-xs font-semibold whitespace-nowrap text-stone-700">
                      {c.numero}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-stone-600">
                      {dateLabel(c.fecha)}
                    </td>
                    <td className="px-3 py-1.5">
                      {/* El ?? es por si la vista suma un origen que este
                          código todavía no conoce: mejor gris que reventar. */}
                      <Badge className={COLOR_TIPO[c.origen] ?? 'bg-stone-100 text-stone-600'}>
                        {c.tipo}
                      </Badge>
                    </td>
                    <td className="px-3 py-1.5 text-stone-800">{c.glosa}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-stone-700">
                      {formatMoney(Number(c.debe), 'BOB')}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-stone-700">
                      {formatMoney(Number(c.haber), 'BOB')}
                    </td>
                    <td className="px-3 py-1.5 text-xs whitespace-nowrap text-stone-500">
                      {fechaHora(c.registrado_en)}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-stone-500">{c.usuario ?? '—'}</td>
                    <td className="px-3 py-1.5 text-right">
                      {doc ? (
                        <Link href={doc} className={btnSecondary}>
                          Ver comprobante
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-stone-300 bg-stone-50 font-semibold">
                <td className="px-4 py-2 text-xs text-stone-500" colSpan={4}>
                  {visibles.length} comprobante{visibles.length === 1 ? '' : 's'}
                  {descuadrados ? ` · ${descuadrados} descuadrado(s)` : ' · todos cuadran'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums" colSpan={2}>
                  {formatMoney(totalDebe, 'BOB')}
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
