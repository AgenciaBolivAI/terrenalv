'use client';

// Balance de Sumas y Saldos, Estado de Resultados y Balance General.
//
// Son los tres papeles que un contador pide primero, y los que el ERP que
// Terrenalv paga hoy entrega. Salen del mismo libro diario, así que no pueden
// contradecirse entre sí: si el balance no cuadra, es porque el diario no
// cuadra, y eso se ve en la misma pantalla.
//
// Cada uno se exporta a CSV y a PDF con el módulo compartido, para que los tres
// lleguen al contador con el mismo membrete y el mismo formato de números.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Spinner, btnSecondary } from '@/features/admin/ui/bits';
import { ExportButtons } from '@/features/admin/export/ExportButtons';
import { num, type Cell } from '@/features/admin/export';
import { dateLabel, monthStartIso, todayIso } from './types';

type Estado = 'sumas' | 'resultados' | 'balance';

interface SumasRow {
  cuenta: string;
  cuenta_nombre: string;
  tipo: string;
  debe: number;
  haber: number;
  saldo_deudor: number;
  saldo_acreedor: number;
}
interface SeccionRow {
  seccion: string;
  cuenta: string;
  cuenta_nombre: string;
  monto: number;
}

const TABS: { id: Estado; label: string }[] = [
  { id: 'sumas', label: 'Sumas y saldos' },
  { id: 'resultados', label: 'Estado de resultados' },
  { id: 'balance', label: 'Balance general' },
];

function Money({ v, bold }: { v: number; bold?: boolean }) {
  return (
    <span className={`tabular-nums ${bold ? 'font-bold' : ''} ${v < 0 ? 'text-red-600' : ''}`}>
      {num(v)}
    </span>
  );
}

export default function Estados({
  projectId,
  projectName,
}: {
  /** null = los libros de la empresa entera, no los de una urbanización. */
  projectId: string | null;
  projectName: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<Estado>('sumas');
  // El bimonetario de CONTAB: cada estado con su columna $us al tipo de
  // cambio configurado. La conversion es DE LECTURA — el libro es en Bs; el
  // $us es la misma cifra dividida por el TC, y el TC usado queda impreso.
  const [tc, setTc] = useState<number | null>(null);
  const [verUsd, setVerUsd] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.rpc('get_exchange_rate', {
        p_project_id: projectId,
      });
      const n = Number(data);
      setTc(Number.isFinite(n) && n > 0 ? n : 6.96);
    })();
  }, [supabase, projectId]);

  const usd = (v: number) => (tc ? Math.round((v / tc) * 100) / 100 : 0);
  const [desde, setDesde] = useState(monthStartIso);
  const [hasta, setHasta] = useState(todayIso);
  const [loading, setLoading] = useState(true);

  const [sumas, setSumas] = useState<SumasRow[]>([]);
  const [resultados, setResultados] = useState<SeccionRow[]>([]);
  const [balance, setBalance] = useState<SeccionRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, r, b] = await Promise.all([
      supabase.rpc('rep_sumas_y_saldos', { p_project_id: projectId, p_desde: desde, p_hasta: hasta }),
      supabase.rpc('rep_estado_resultados', { p_project_id: projectId, p_desde: desde, p_hasta: hasta }),
      supabase.rpc('rep_balance_general', { p_project_id: projectId, p_hasta: hasta }),
    ]);
    setSumas((s.data ?? []) as unknown as SumasRow[]);
    setResultados((r.data ?? []) as unknown as SeccionRow[]);
    setBalance((b.data ?? []) as unknown as SeccionRow[]);
    setLoading(false);
  }, [supabase, projectId, desde, hasta]);

  useEffect(() => {
    void load();
  }, [load]);

  const periodo = `${projectName} · ${dateLabel(desde)} a ${dateLabel(hasta)}`;
  const corte = `${projectName} · al ${dateLabel(hasta)}`;

  // ---- Totales -----------------------------------------------------------
  const tDebe = sumas.reduce((a, r) => a + Number(r.debe), 0);
  const tHaber = sumas.reduce((a, r) => a + Number(r.haber), 0);
  const tDeudor = sumas.reduce((a, r) => a + Number(r.saldo_deudor), 0);
  const tAcreedor = sumas.reduce((a, r) => a + Number(r.saldo_acreedor), 0);

  const ingresos = resultados.filter((r) => r.seccion === 'Ingresos');
  const gastos = resultados.filter((r) => r.seccion === 'Gastos');
  const tIngresos = ingresos.reduce((a, r) => a + Number(r.monto), 0);
  const tGastos = gastos.reduce((a, r) => a + Number(r.monto), 0);

  const secciones = ['Activo', 'Pasivo', 'Patrimonio'] as const;
  const totalPor = (s: string) =>
    balance.filter((r) => r.seccion === s).reduce((a, r) => a + Number(r.monto), 0);
  const tActivo = totalPor('Activo');
  const tPasivoPatrimonio = totalPor('Pasivo') + totalPor('Patrimonio');
  const cuadra = Math.abs(tActivo - tPasivoPatrimonio) < 0.01;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-xl border border-stone-200 bg-white p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id}
              className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t.id ? 'bg-brand text-white' : 'text-stone-600 hover:bg-stone-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-xs text-stone-600">
          <input type="checkbox" checked={verUsd} onChange={(e) => setVerUsd(e.target.checked)} />
          Ver también en $us{tc ? ` (TC ${tc})` : ''}
        </label>
        <label className="flex items-center gap-2 text-xs text-stone-500">
          Desde
          <input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            disabled={tab === 'balance'}
            title={tab === 'balance' ? 'El balance general es a una fecha de corte' : undefined}
            className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-sm disabled:opacity-40"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-stone-500">
          {tab === 'balance' ? 'Al' : 'Hasta'}
          <input
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-sm"
          />
        </label>
        <button type="button" className={`${btnSecondary} ml-auto`} onClick={() => void load()}>
          Actualizar
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : null}

      {/* ------------------------------ SUMAS Y SALDOS -------------------- */}
      {!loading && tab === 'sumas' ? (
        <section className="rounded-xl border border-stone-200 bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 px-4 py-3">
            <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
              Balance de sumas y saldos
            </h2>
            <ExportButtons
              disabled={!sumas.length}
              meta={{
                title: 'Balance de Sumas y Saldos',
                subtitle: periodo,
                filename: `sumas-y-saldos-${desde}-a-${hasta}`,
                footnote: 'Generado desde el libro diario. Cifras en bolivianos.',
              }}
              columns={[
                { header: 'Cuenta' },
                { header: 'Nombre' },
                { header: 'Debe', align: 'right' },
                { header: 'Haber', align: 'right' },
                { header: 'Saldo deudor', align: 'right' },
                { header: 'Saldo acreedor', align: 'right' },
              ]}
              rows={() =>
                [
                  ...sumas.map((r) => [
                    r.cuenta,
                    r.cuenta_nombre,
                    num(Number(r.debe)),
                    num(Number(r.haber)),
                    num(Number(r.saldo_deudor)),
                    num(Number(r.saldo_acreedor)),
                  ]),
                  ['', 'TOTALES', num(tDebe), num(tHaber), num(tDeudor), num(tAcreedor)],
                ] as Cell[][]
              }
              orientation="landscape"
            />
          </div>
          {!sumas.length ? (
            <p className="py-10 text-center text-sm text-stone-400">Sin movimientos en el período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-200 text-sm">
                <thead>
                  <tr className="border-b border-stone-200 bg-stone-50 text-left">
                    <th className="px-4 py-2 text-xs font-semibold text-stone-500">Cuenta</th>
                    <th className="px-3 py-2 text-xs font-semibold text-stone-500">Nombre</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Debe</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Haber</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">S. deudor</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">S. acreedor</th>
                  </tr>
                </thead>
                <tbody>
                  {sumas.map((r) => (
                    <tr key={r.cuenta} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                      <td className="px-4 py-1.5 font-mono text-xs text-stone-600">{r.cuenta}</td>
                      <td className="px-3 py-1.5 text-stone-800">{r.cuenta_nombre}</td>
                      <td className="px-3 py-1.5 text-right"><Money v={Number(r.debe)} /></td>
                      <td className="px-3 py-1.5 text-right"><Money v={Number(r.haber)} /></td>
                      <td className="px-3 py-1.5 text-right"><Money v={Number(r.saldo_deudor)} /></td>
                      <td className="px-3 py-1.5 text-right"><Money v={Number(r.saldo_acreedor)} /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-stone-300 bg-stone-50">
                    <td className="px-4 py-2 text-xs font-semibold text-stone-500" colSpan={2}>
                      TOTALES — debe y haber deben coincidir
                    </td>
                    <td className="px-3 py-2 text-right"><Money v={tDebe} bold /></td>
                    <td className="px-3 py-2 text-right"><Money v={tHaber} bold /></td>
                    <td className="px-3 py-2 text-right"><Money v={tDeudor} bold /></td>
                    <td className="px-3 py-2 text-right"><Money v={tAcreedor} bold /></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {/* ------------------------------ RESULTADOS ------------------------ */}
      {!loading && tab === 'resultados' ? (
        <section className="rounded-xl border border-stone-200 bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 px-4 py-3">
            <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
              Estado de resultados
            </h2>
            <ExportButtons
              disabled={!resultados.length}
              meta={{
                title: 'Estado de Resultados',
                subtitle: periodo,
                filename: `estado-resultados-${desde}-a-${hasta}`,
                footnote: 'Cifras en bolivianos. Ingresos reconocidos al confirmarse la venta.',
              }}
              columns={[
                { header: 'Sección' },
                { header: 'Cuenta' },
                { header: 'Nombre' },
                { header: 'Monto', align: 'right' },
              ]}
              rows={() =>
                [
                  ...ingresos.map((r) => ['Ingresos', r.cuenta, r.cuenta_nombre, num(Number(r.monto))]),
                  ['', '', 'Total ingresos', num(tIngresos)],
                  ...gastos.map((r) => ['Gastos', r.cuenta, r.cuenta_nombre, num(Number(r.monto))]),
                  ['', '', 'Total gastos', num(tGastos)],
                  ['', '', 'RESULTADO DEL PERÍODO', num(tIngresos - tGastos)],
                ] as Cell[][]
              }
            />
          </div>
          {!resultados.length ? (
            <p className="py-10 text-center text-sm text-stone-400">Sin movimientos en el período.</p>
          ) : (
            <div className="p-4">
              {(
                [
                  ['Ingresos', ingresos, tIngresos],
                  ['Gastos', gastos, tGastos],
                ] as [string, SeccionRow[], number][]
              ).map(([titulo, filas, total]) => (
                <div key={titulo} className="mb-5">
                  <h3 className="annot mb-1 text-stone-400">{titulo}</h3>
                  <table className="w-full text-sm">
                    <tbody>
                      {filas.map((r) => (
                        <tr key={r.cuenta} className="border-b border-stone-100">
                          <td className="py-1.5 font-mono text-xs text-stone-500">{r.cuenta}</td>
                          <td className="py-1.5 text-stone-800">{r.cuenta_nombre}</td>
                          <td className="py-1.5 text-right"><Money v={Number(r.monto)} /></td>
                          {verUsd ? (
                            <td className="py-1.5 text-right text-stone-500">
                              <Money v={usd(Number(r.monto))} />
                            </td>
                          ) : null}
                        </tr>
                      ))}
                      <tr className="border-t border-stone-300">
                        <td className="py-2 text-xs font-semibold text-stone-500" colSpan={2}>
                          Total {titulo.toLowerCase()}
                        </td>
                        <td className="py-2 text-right"><Money v={total} bold /></td>
                        {verUsd ? (
                          <td className="py-2 text-right text-stone-500">
                            <Money v={usd(total)} bold />
                          </td>
                        ) : null}
                      </tr>
                    </tbody>
                  </table>
                </div>
              ))}
              <div
                className={`flex items-center justify-between rounded-lg px-4 py-3 ${
                  tIngresos - tGastos >= 0 ? 'bg-green-50' : 'bg-red-50'
                }`}
              >
                <span className="text-sm font-bold text-stone-800">Resultado del período</span>
                <span className="text-lg font-black tabular-nums text-stone-900">
                  Bs {num(tIngresos - tGastos)}
                </span>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {/* ------------------------------ BALANCE --------------------------- */}
      {!loading && tab === 'balance' ? (
        <section className="rounded-xl border border-stone-200 bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 px-4 py-3">
            <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
              Balance general
            </h2>
            <ExportButtons
              disabled={!balance.length}
              meta={{
                title: 'Balance General',
                subtitle: corte,
                filename: `balance-general-al-${hasta}`,
                footnote: 'Cifras en bolivianos. Incluye el resultado del ejercicio en Patrimonio.',
              }}
              columns={[
                { header: 'Sección' },
                { header: 'Cuenta' },
                { header: 'Nombre' },
                { header: 'Monto', align: 'right' },
              ]}
              rows={() =>
                [
                  ...balance.map((r) => [r.seccion, r.cuenta, r.cuenta_nombre, num(Number(r.monto))]),
                  ['', '', 'TOTAL ACTIVO', num(tActivo)],
                  ['', '', 'TOTAL PASIVO + PATRIMONIO', num(tPasivoPatrimonio)],
                ] as Cell[][]
              }
            />
          </div>
          {!balance.length ? (
            <p className="py-10 text-center text-sm text-stone-400">Sin movimientos hasta esa fecha.</p>
          ) : (
            <div className="p-4">
              {secciones.map((s) => {
                const filas = balance.filter((r) => r.seccion === s);
                if (!filas.length) return null;
                return (
                  <div key={s} className="mb-5">
                    <h3 className="annot mb-1 text-stone-400">{s}</h3>
                    <table className="w-full text-sm">
                      <tbody>
                        {filas.map((r) => (
                          <tr key={r.cuenta} className="border-b border-stone-100">
                            <td className="py-1.5 font-mono text-xs text-stone-500">{r.cuenta}</td>
                            <td className="py-1.5 text-stone-800">{r.cuenta_nombre}</td>
                            <td className="py-1.5 text-right"><Money v={Number(r.monto)} /></td>
                          {verUsd ? (
                            <td className="py-1.5 text-right text-stone-500">
                              <Money v={usd(Number(r.monto))} />
                            </td>
                          ) : null}
                          </tr>
                        ))}
                        <tr className="border-t border-stone-300">
                          <td className="py-2 text-xs font-semibold text-stone-500" colSpan={2}>
                            Total {s.toLowerCase()}
                          </td>
                          <td className="py-2 text-right"><Money v={totalPor(s)} bold /></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                );
              })}
              {/* La comprobación que hace un contador antes de leer nada más. */}
              <div
                className={`rounded-lg px-4 py-3 text-sm ${
                  cuadra ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
                }`}
              >
                {cuadra ? '✓ ' : '⚠ '}
                Activo <strong>Bs {num(tActivo)}</strong> {cuadra ? '=' : '≠'} Pasivo + Patrimonio{' '}
                <strong>Bs {num(tPasivoPatrimonio)}</strong>
                {cuadra ? '' : ' — el libro diario no está cuadrando.'}
              </div>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
