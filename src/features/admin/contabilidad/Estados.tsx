'use client';

// Balance de Sumas y Saldos, Estado de Resultados, Balance General y Flujo de
// Efectivo.
//
// Son los papeles que un contador pide primero, y los que el ERP que
// Terrenalv paga hoy entrega. Salen del mismo libro diario, así que no pueden
// contradecirse entre sí: si el balance no cuadra, es porque el diario no
// cuadra, y eso se ve en la misma pantalla.
//
// El flujo de efectivo es el único de los cuatro en base caja: lo que de
// verdad entró y salió por caja y banco, sin devengar nada. La utilidad puede
// ser linda y la caja estar seca — ese papel es el que lo muestra.
//
// Cada uno se exporta a CSV y a PDF con el módulo compartido, para que los tres
// lleguen al contador con el mismo membrete y el mismo formato de números.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Kpi, Spinner, btnSecondary } from '@/features/admin/ui/bits';
import { GroupedBars, Legend } from '@/features/admin/analitica/Charts';
import { ExportButtons } from '@/features/admin/export/ExportButtons';
import { num, type Cell } from '@/features/admin/export';
import { dateLabel, monthLabel, monthStartIso, todayIso, type MonthlyCashflow } from './types';

type Estado = 'sumas' | 'resultados' | 'balance' | 'flujo';

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
/** Una fila del flujo: sección + contracuenta legible, con el monto siempre
 *  positivo — el signo lo pone la sección, no el número. */
interface FlujoRow {
  seccion: string;
  categoria: string;
  cuenta: string;
  monto: number;
  movimientos: number;
}
/** Lo que este papel muestra de v_tesoreria_saldos: dónde está la plata hoy. */
interface TesoRow {
  name: string;
  bank_name: string | null;
  account_number: string | null;
  saldo: number;
}
/** Categoría ya agregada, para las tablas "de dónde entra / a dónde sale". */
interface CatRow {
  categoria: string;
  monto: number;
  movimientos: number;
}

const TABS: { id: Estado; label: string }[] = [
  { id: 'sumas', label: 'Sumas y saldos' },
  { id: 'resultados', label: 'Estado de resultados' },
  { id: 'balance', label: 'Balance general' },
  { id: 'flujo', label: 'Flujo de efectivo' },
];

// Colores de la paleta de analítica: el de la casa para lo que entra y el de
// alerta para lo que sale, como en el resto de los gráficos del panel.
const SERIE_FLUJO = { entradas: 'var(--an-1)', salidas: 'var(--an-5)' };

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
  const [flujo, setFlujo] = useState<FlujoRow[]>([]);
  const [cashflow, setCashflow] = useState<MonthlyCashflow[]>([]);
  const [tesoreria, setTesoreria] = useState<TesoRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, r, b, f, cf, tes] = await Promise.all([
      supabase.rpc('rep_sumas_y_saldos', { p_project_id: projectId, p_desde: desde, p_hasta: hasta }),
      supabase.rpc('rep_estado_resultados', { p_project_id: projectId, p_desde: desde, p_hasta: hasta }),
      supabase.rpc('rep_balance_general', { p_project_id: projectId, p_hasta: hasta }),
      supabase.rpc('rep_flujo_efectivo', { p_project_id: projectId, p_desde: desde, p_hasta: hasta }),
      // La vista mensual viene por urbanización y mes: acá se recorta al mes
      // calendario del período elegido, y si se mira la empresa entera se
      // agrega por mes más abajo.
      (() => {
        let q = supabase
          .from('v_monthly_cashflow')
          .select('*')
          .gte('mes', `${desde.slice(0, 7)}-01`)
          .lte('mes', hasta);
        if (projectId) q = q.eq('project_id', projectId);
        return q.order('mes');
      })(),
      // Sólo cuentas activas: una cuenta cerrada con saldo es un problema de
      // Tesorería y ya tiene su alerta en esa pantalla, no en este papel.
      supabase.from('v_tesoreria_saldos').select('*').eq('is_active', true).order('name'),
    ]);
    setSumas((s.data ?? []) as unknown as SumasRow[]);
    setResultados((r.data ?? []) as unknown as SeccionRow[]);
    setBalance((b.data ?? []) as unknown as SeccionRow[]);
    setFlujo((f.data ?? []) as unknown as FlujoRow[]);
    setCashflow((cf.data ?? []) as unknown as MonthlyCashflow[]);
    setTesoreria((tes.data ?? []) as unknown as TesoRow[]);
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

  // ---- Flujo de efectivo -------------------------------------------------
  // El RPC ya viene agrupado por contracuenta, pero puede traer más de una
  // fila por categoría; la tabla de gerencia es "por categoría", así que se
  // agrega acá y se ordena de mayor a menor — lo gordo arriba.
  const porCategoria = (seccion: string): CatRow[] => {
    const m = new Map<string, { monto: number; movimientos: number }>();
    for (const r of flujo) {
      if (r.seccion !== seccion) continue;
      const acc = m.get(r.categoria) ?? { monto: 0, movimientos: 0 };
      acc.monto += Number(r.monto);
      acc.movimientos += Number(r.movimientos);
      m.set(r.categoria, acc);
    }
    return [...m.entries()]
      .map(([categoria, v]) => ({ categoria, ...v }))
      .sort((a, b) => b.monto - a.monto);
  };
  const entradasCat = porCategoria('Entradas');
  const salidasCat = porCategoria('Salidas');
  const transfCat = porCategoria('Transferencias internas');
  const tEntradas = entradasCat.reduce((a, r) => a + r.monto, 0);
  const tSalidas = salidasCat.reduce((a, r) => a + r.monto, 0);
  const tTransf = transfCat.reduce((a, r) => a + r.monto, 0);
  const movsTransf = transfCat.reduce((a, r) => a + r.movimientos, 0);
  const netoFlujo = tEntradas - tSalidas;

  // La vista trae una fila por urbanización y mes: mirando la empresa entera
  // hay que agregar por mes, o el gráfico dibujaría una barra por proyecto.
  const mensualMap = new Map<string, { entradas: number; salidas: number }>();
  for (const r of cashflow) {
    const clave = r.mes.slice(0, 10);
    const acc = mensualMap.get(clave) ?? { entradas: 0, salidas: 0 };
    acc.entradas += Number(r.ingresos_bob);
    acc.salidas += Number(r.egresos_bob);
    mensualMap.set(clave, acc);
  }
  const mensual = [...mensualMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, v]) => ({
      label: monthLabel(mes),
      values: { entradas: v.entradas, salidas: v.salidas },
    }));
  const resultadoMensual = cashflow.reduce((a, r) => a + Number(r.resultado_bob), 0);
  const cuadraFlujo = Math.abs(netoFlujo - resultadoMensual) < 0.01;

  const saldoTesoreria = tesoreria.reduce((a, r) => a + Number(r.saldo), 0);
  const pctDe = (v: number, total: number) => (total > 0 ? `${num((v / total) * 100, 1)}%` : '—');
  // La regla de la casa: toda cifra abre lo que cuenta. Acá el detalle vive
  // en la misma pantalla, así que el clic baja hasta la tabla que la explica.
  const irA = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

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

      {/* ------------------------------ FLUJO ----------------------------- */}
      {!loading && tab === 'flujo' ? (
        <section className="rounded-xl border border-stone-200 bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 px-4 py-3">
            <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
              Flujo de efectivo
            </h2>
            <ExportButtons
              disabled={!flujo.length && !tesoreria.length}
              meta={{
                title: 'Flujo de Efectivo',
                subtitle: periodo,
                filename: `flujo-efectivo-${desde}-a-${hasta}`,
                footnote:
                  'Base caja: movimientos reales por las cuentas de caja y banco según el libro diario. Cifras en bolivianos.',
              }}
              columns={[
                { header: 'Sección' },
                { header: 'Detalle' },
                { header: 'Movs.', align: 'right' },
                { header: 'Monto', align: 'right' },
                { header: '%', align: 'right' },
              ]}
              rows={() => {
                const filas: Cell[][] = [];
                (
                  [
                    ['Entradas', entradasCat, tEntradas],
                    ['Salidas', salidasCat, tSalidas],
                  ] as [string, CatRow[], number][]
                ).forEach(([titulo, cats, total]) => {
                  for (const c of cats)
                    filas.push([titulo, c.categoria, c.movimientos, num(c.monto), pctDe(c.monto, total)]);
                  filas.push([titulo, `Total ${titulo.toLowerCase()}`, '', num(total), '']);
                });
                if (tTransf > 0)
                  filas.push([
                    'Transferencias internas',
                    'Entre cuentas propias — no son entrada ni salida',
                    movsTransf,
                    num(tTransf),
                    '',
                  ]);
                filas.push(['', 'NETO DEL PERÍODO (entradas − salidas)', '', num(netoFlujo), '']);
                filas.push(['Tesorería', 'Dónde está la plata hoy', '', '', '']);
                for (const t of tesoreria)
                  filas.push([
                    '',
                    [t.name, t.bank_name, t.account_number].filter(Boolean).join(' · '),
                    '',
                    num(Number(t.saldo)),
                    '',
                  ]);
                filas.push(['', 'Total en cuentas activas', '', num(saldoTesoreria), '']);
                return filas;
              }}
            />
          </div>
          <div className="space-y-5 p-4">
            {/* Los cuatro números que gerencia mira antes que nada. Cada uno
                abre lo que cuenta, que acá vive en la misma pantalla. */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi
                label="Entradas"
                value={`Bs ${num(tEntradas)}`}
                hint={`${entradasCat.length} categoría(s) — ver detalle`}
                tone="good"
                onClick={() => irA('flujo-entradas')}
              />
              <Kpi
                label="Salidas"
                value={`Bs ${num(tSalidas)}`}
                hint={`${salidasCat.length} categoría(s) — ver detalle`}
                onClick={() => irA('flujo-salidas')}
              />
              <Kpi
                label="Neto del período"
                value={`Bs ${num(netoFlujo)}`}
                tone={netoFlujo >= 0 ? 'good' : 'bad'}
                hint="Entradas − salidas, base caja"
                onClick={() => irA('flujo-cuadre')}
              />
              <Kpi
                label="Saldo en tesorería"
                value={`Bs ${num(saldoTesoreria)}`}
                tone={saldoTesoreria < 0 ? 'bad' : 'normal'}
                hint={
                  projectId
                    ? 'De la empresa entera — ver cuentas'
                    : `${tesoreria.length} cuenta(s) activa(s)`
                }
                onClick={() => irA('flujo-tesoreria')}
              />
            </div>

            <div>
              <h3 className="annot mb-1 text-stone-400">Mes a mes</h3>
              <GroupedBars
                data={mensual}
                series={[
                  { key: 'entradas', label: 'Entradas', color: SERIE_FLUJO.entradas },
                  { key: 'salidas', label: 'Salidas', color: SERIE_FLUJO.salidas },
                ]}
                format={(n) => num(n, 0)}
              />
              <Legend
                items={[
                  { label: 'Entradas', color: SERIE_FLUJO.entradas },
                  { label: 'Salidas', color: SERIE_FLUJO.salidas },
                ]}
              />
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              {(
                [
                  ['flujo-entradas', 'De dónde entra', entradasCat, tEntradas, 'Sin entradas en el período.'],
                  ['flujo-salidas', 'A dónde sale', salidasCat, tSalidas, 'Sin salidas en el período.'],
                ] as [string, string, CatRow[], number, string][]
              ).map(([id, titulo, cats, total, vacio]) => (
                <div key={id} id={id}>
                  <h3 className="annot mb-1 text-stone-400">{titulo}</h3>
                  {!cats.length ? (
                    <p className="py-4 text-center text-sm text-stone-400">{vacio}</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-stone-200 text-left">
                          <th className="py-1.5 text-xs font-semibold text-stone-500">Categoría</th>
                          <th className="py-1.5 text-right text-xs font-semibold text-stone-500">Movs.</th>
                          <th className="py-1.5 text-right text-xs font-semibold text-stone-500">Monto</th>
                          <th className="py-1.5 text-right text-xs font-semibold text-stone-500">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cats.map((c) => (
                          <tr key={c.categoria} className="border-b border-stone-100">
                            <td className="py-1.5 text-stone-800">{c.categoria}</td>
                            <td className="py-1.5 text-right tabular-nums text-stone-500">{c.movimientos}</td>
                            <td className="py-1.5 text-right"><Money v={c.monto} /></td>
                            <td className="py-1.5 text-right tabular-nums text-stone-400">
                              {pctDe(c.monto, total)}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t border-stone-300">
                          <td className="py-2 text-xs font-semibold text-stone-500" colSpan={2}>
                            Total
                          </td>
                          <td className="py-2 text-right"><Money v={total} bold /></td>
                          <td />
                        </tr>
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
            </div>

            {tTransf > 0 ? (
              <p className="rounded-lg bg-stone-50 px-4 py-2.5 text-sm text-stone-600">
                Transferencias internas: <strong className="tabular-nums">Bs {num(tTransf)}</strong> en{' '}
                {movsTransf} movimiento(s) — plata que se movió entre cuentas propias. No es entrada ni
                salida, por eso va aparte y no infla ninguna de las dos columnas.
              </p>
            ) : null}

            <div id="flujo-tesoreria">
              <h3 className="annot mb-1 text-stone-400">Dónde está la plata</h3>
              {/* Saldos de HOY, no del corte del período: la caja es una foto,
                  y es de la empresa entera — no se reparte por urbanización. */}
              <p className="mb-2 text-xs text-stone-400">Saldos al día de hoy, empresa entera.</p>
              {!tesoreria.length ? (
                <p className="py-4 text-center text-sm text-stone-400">
                  Sin cuentas de tesorería activas.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 text-left">
                      <th className="py-1.5 text-xs font-semibold text-stone-500">Cuenta</th>
                      <th className="py-1.5 text-xs font-semibold text-stone-500">Banco</th>
                      <th className="py-1.5 text-xs font-semibold text-stone-500">Nro.</th>
                      <th className="py-1.5 text-right text-xs font-semibold text-stone-500">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tesoreria.map((t) => (
                      <tr key={`${t.name}·${t.account_number ?? ''}`} className="border-b border-stone-100">
                        <td className="py-1.5 text-stone-800">{t.name}</td>
                        <td className="py-1.5 text-stone-600">{t.bank_name ?? '—'}</td>
                        <td className="py-1.5 font-mono text-xs text-stone-500">{t.account_number ?? '—'}</td>
                        <td className="py-1.5 text-right"><Money v={Number(t.saldo)} /></td>
                      </tr>
                    ))}
                    <tr className="border-t border-stone-300">
                      <td className="py-2 text-xs font-semibold text-stone-500" colSpan={3}>
                        Total en cuentas activas
                      </td>
                      <td className="py-2 text-right"><Money v={saldoTesoreria} bold /></td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>

            {/* El mismo cuadre que hace el contador con el balance: dos caminos
                distintos al mismo número. El RPC recorre el libro por caja y
                banco; la vista mensual suma por su lado. */}
            <div
              id="flujo-cuadre"
              className={`rounded-lg px-4 py-3 text-sm ${
                cuadraFlujo ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
              }`}
            >
              {cuadraFlujo ? '✓ ' : '⚠ '}
              Neto del flujo <strong>Bs {num(netoFlujo)}</strong> {cuadraFlujo ? '=' : '≠'} resultado de
              la vista mensual <strong>Bs {num(resultadoMensual)}</strong>
              {cuadraFlujo
                ? ''
                : ' — si el período no corta en meses enteros, la vista mensual trae el mes completo; si corta justo, uno de los dos caminos está viendo un movimiento que el otro no.'}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
