'use client';

// BALANCE DE SUMAS Y SALDOS — del libro fiscal.
//
// La misma cara que el de contabilidad (Estados.tsx), a propósito: el contador
// pone los dos papeles lado a lado y compara sin aprender otro formato. La
// diferencia es la fuente — rep_fiscal_sumas_y_saldos suma SOLO lo declarado,
// del libro fiscal y de ningún otro lado. Si acá no cuadra, el problema está
// en el libro fiscal, no en el gerencial.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Spinner, btnSecondary } from '@/features/admin/ui/bits';
import { ExportButtons } from '@/features/admin/export/ExportButtons';
import { num, type Cell } from '@/features/admin/export';
import { dateLabel, monthStartIso, todayIso } from '@/features/admin/contabilidad/types';

/** Una fila del RPC, con la misma forma que rep_sumas_y_saldos. */
interface SumasRow {
  cuenta: string;
  cuenta_nombre: string;
  tipo: string;
  sort_order: number;
  debe: number;
  haber: number;
  saldo_deudor: number;
  saldo_acreedor: number;
}

function Money({ v, bold }: { v: number; bold?: boolean }) {
  return (
    <span className={`tabular-nums ${bold ? 'font-bold' : ''} ${v < 0 ? 'text-red-600' : ''}`}>
      {num(v)}
    </span>
  );
}

export default function SumasFiscal({
  projectId,
  projectName,
}: {
  projectId: string | null;
  projectName: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [desde, setDesde] = useState(monthStartIso);
  const [hasta, setHasta] = useState(todayIso);
  const [loading, setLoading] = useState(true);
  const [sumas, setSumas] = useState<SumasRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc('rep_fiscal_sumas_y_saldos', {
      p_project_id: projectId,
      p_desde: desde,
      p_hasta: hasta,
    });
    setSumas((data ?? []) as unknown as SumasRow[]);
    setLoading(false);
  }, [supabase, projectId, desde, hasta]);

  useEffect(() => {
    void load();
  }, [load]);

  const tDebe = sumas.reduce((a, r) => a + Number(r.debe), 0);
  const tHaber = sumas.reduce((a, r) => a + Number(r.haber), 0);
  const tDeudor = sumas.reduce((a, r) => a + Number(r.saldo_deudor), 0);
  const tAcreedor = sumas.reduce((a, r) => a + Number(r.saldo_acreedor), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="ml-auto flex items-center gap-2 text-xs text-stone-500">
          Desde
          <input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-stone-500">
          Hasta
          <input
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-sm"
          />
        </label>
        <button type="button" className={btnSecondary} onClick={() => void load()}>
          Actualizar
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : (
        <section className="rounded-xl border border-stone-200 bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 px-4 py-3">
            <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
              Balance de sumas y saldos — libro fiscal
            </h2>
            <ExportButtons
              disabled={!sumas.length}
              meta={{
                title: 'Balance de Sumas y Saldos — Libro fiscal',
                subtitle: `Terrenalv S.R.L. · ${projectName} · ${dateLabel(desde)} a ${dateLabel(hasta)}`,
                filename: `sumas-y-saldos-fiscal-${desde}-a-${hasta}`,
                footnote:
                  'Generado desde el libro fiscal: suma solo lo declarado. Cifras en bolivianos.',
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
            <p className="py-10 text-center text-sm text-stone-400">
              Nada declarado en el período.
            </p>
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
      )}
    </div>
  );
}
