'use client';

// CONTABILIDAD FISCAL — el libro que se declara.
//
// El gerencial es la verdad del negocio: toda la plata, esté a nombre de
// quien esté. Este es lo que la empresa declara, y son dos cosas distintas.
//
// Este módulo LEE del gerencial: trae movimientos, los copia acá y guarda de
// cuál vino. El gerencial no sabe que este módulo existe — ni una vista ni
// una función suya lo nombra, y hay un guardián en verificar_integridad() que
// lo comprueba en cada despliegue.
//
// Nada se importa solo. Lo que está a nombre de un tercero queda marcado y no
// entra salvo que alguien lo decida a mano, por escrito.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/format';
import {
  Badge,
  EmptyState,
  Kpi,
  Spinner,
  btnPrimary,
  btnSecondary,
  inputClass,
} from '@/features/admin/ui/bits';
import { Dialog } from '@/features/admin/ui/dialog';
import { useToast } from '@/features/admin/ui/toast';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';
import { dateLabel } from '@/features/admin/contabilidad/types';
import { useAdmin } from '@/features/admin/shell/AdminContext';
import { ExportButtons } from '@/features/admin/export/ExportButtons';
import { num as fnum, type Cell as XCell } from '@/features/admin/export';
import LibroIva from './LibroIva';
import SumasFiscal from './SumasFiscal';
import ComprobanteSoloFiscal from './ComprobanteSoloFiscal';

interface Pendiente {
  project_id: string;
  origen: string;
  origen_id: string;
  fecha: string;
  comprobante: string;
  glosa: string;
  /** La cuenta gerencial del movimiento; si su ámbito es 'gerencial', no declara. */
  cuenta_nombre: string | null;
  cuenta_ambito: string | null;
  cliente: string | null;
  titular: string;
  titular_nombre: string | null;
  debe: number;
  haber: number;
  excluido: boolean;
  motivo_exclusion: string | null;
}

interface LineaFiscal {
  project_id: string;
  fecha: string;
  comprobante: string;
  glosa: string;
  cuenta: string;
  debe: number;
  haber: number;
  comprobante_id: string;
  origen: string | null;
  solo_fiscal: boolean;
}

const ORIGEN_LABEL: Record<string, string> = {
  venta: 'Venta',
  pago: 'Cobro',
  egreso: 'Egreso',
  comprobante: 'Comprobante',
  terreno: 'Compra de terreno',
  activo: 'Activo fijo',
  fondo: 'Fondo a rendir',
};

type Vista = 'pendiente' | 'libro' | 'sumas' | 'excluidos' | 'iva';

export default function FiscalClient() {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const { projectId, projectName } = useAdmin();

  const [vista, setVista] = useState<Vista>('pendiente');
  const [pend, setPend] = useState<Pendiente[]>([]);
  const [libro, setLibro] = useState<LineaFiscal[]>([]);
  const [loading, setLoading] = useState(true);
  const [excluyendo, setExcluyendo] = useState<Pendiente | null>(null);
  const [motivo, setMotivo] = useState('');
  const [importando, setImportando] = useState(false);
  const [soloFiscal, setSoloFiscal] = useState(false);
  const [rango, setRango] = useState<{
    desde: string;
    hasta: string;
    terceros: boolean;
    cuentasGerenciales: boolean;
  } | null>(null);

  const cargar = useCallback(async () => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    const [p, l] = await Promise.all([
      supabase
        .from('v_fiscal_pendiente')
        .select('*')
        .eq('project_id', projectId)
        .order('fecha', { ascending: false })
        .limit(1000),
      supabase
        .from('v_fiscal_libro_diario')
        .select('*')
        .eq('project_id', projectId)
        .order('fecha', { ascending: false })
        .limit(2000),
    ]);
    setPend((p.data ?? []) as unknown as Pendiente[]);
    setLibro((l.data ?? []) as unknown as LineaFiscal[]);
    setLoading(false);
  }, [supabase, projectId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const porImportar = useMemo(() => pend.filter((p) => !p.excluido), [pend]);
  const excluidos = useMemo(() => pend.filter((p) => p.excluido), [pend]);
  const deTerceros = useMemo(
    () => porImportar.filter((p) => p.titular === 'tercero').length,
    [porImportar],
  );
  const declarado = useMemo(() => libro.reduce((s, l) => s + Number(l.debe), 0), [libro]);
  const comprobantes = useMemo(
    () => new Set(libro.map((l) => l.comprobante_id)).size,
    [libro],
  );

  async function importarUno(p: Pendiente) {
    const { error } = await supabase.rpc('fiscal_importar_uno', {
      p_origen: p.origen,
      p_origen_id: p.origen_id,
      p_nota: p.titular === 'tercero' ? 'declarado a mano pese a estar a nombre de un tercero' : null,
    });
    if (error) {
      push(adminErrorCopy(error.message), 'error');
      return;
    }
    push('Movimiento declarado en el libro fiscal.', 'success');
    void cargar();
  }

  async function anular(comprobanteId: string, numero: string) {
    const nota = window.prompt(`Anular el comprobante fiscal ${numero}. ¿Por qué?`);
    if (!nota || !nota.trim()) return;
    const { error } = await supabase.rpc('fiscal_anular_comprobante', {
      p_id: comprobanteId,
      p_nota: nota.trim(),
    });
    if (error) {
      push(adminErrorCopy(error.message), 'error');
      return;
    }
    push('Comprobante anulado. El movimiento vuelve a quedar disponible.', 'success');
    void cargar();
  }

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
        <h1 className="text-lg font-bold text-stone-900">Contabilidad fiscal</h1>
        <p className="text-xs text-stone-500">
          Lo que se declara, de {projectName}. Se sirve del gerencial; el gerencial no sabe que
          esto existe.
        </p>
        <button
          type="button"
          className={`${btnPrimary} ml-auto`}
          onClick={() =>
            setRango({
              desde: new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10),
              hasta: new Date().toISOString().slice(0, 10),
              terceros: false,
              cuentasGerenciales: false,
            })
          }
        >
          Importar del gerencial
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Declarado"
          value={formatMoney(declarado, 'BOB')}
          tone="good"
          hint={`${comprobantes} comprobante(s) fiscal(es) — ver`}
          onClick={() => setVista('libro')}
        />
        <Kpi
          label="Por declarar"
          value={String(porImportar.length)}
          tone={porImportar.length > 0 ? 'bad' : 'normal'}
          hint="movimientos del gerencial sin declarar — ver"
          onClick={() => setVista('pendiente')}
        />
        <Kpi
          label="A nombre de terceros"
          value={String(deTerceros)}
          hint="no entran solos: hay que decidirlos — ver"
          onClick={() => setVista('pendiente')}
        />
        <Kpi
          label="Dejados afuera"
          value={String(excluidos.length)}
          hint="con su motivo escrito — ver"
          onClick={() => setVista('excluidos')}
        />
      </div>

      <div className="flex gap-1 rounded-xl border border-stone-200 bg-white p-1">
        {(
          [
            ['pendiente', `Por declarar (${porImportar.length})`],
            ['libro', `Libro fiscal (${comprobantes})`],
            ['sumas', 'Sumas y saldos'],
            ['excluidos', `Afuera (${excluidos.length})`],
            ['iva', 'Compras y ventas IVA'],
          ] as [Vista, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setVista(id)}
            className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium ${
              vista === id ? 'bg-green-50 text-brand' : 'text-stone-600 hover:bg-stone-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {vista === 'iva' ? <LibroIva /> : null}

      {vista === 'sumas' ? <SumasFiscal projectId={projectId} projectName={projectName} /> : null}

      {/* ---------- por declarar ---------- */}
      {vista === 'pendiente' ? (
        <section className="rounded-xl border border-stone-200 bg-white">
          {porImportar.length === 0 ? (
            <div className="px-4 py-8">
              <EmptyState
                title="No queda nada por declarar"
                hint="Todo lo del gerencial ya está en el libro fiscal o quedó afuera con su motivo."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-stone-200 bg-stone-50 text-left">
                    <th className="px-4 py-2 text-xs font-semibold text-stone-500">Fecha</th>
                    <th className="px-3 py-2 text-xs font-semibold text-stone-500">Movimiento</th>
                    <th className="px-3 py-2 text-xs font-semibold text-stone-500">Cliente</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                      Monto
                    </th>
                    <th className="px-3 py-2 text-xs font-semibold text-stone-500">A nombre de</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {porImportar.slice(0, 300).map((p) => (
                    <tr key={`${p.origen}-${p.origen_id}`} className="border-b border-stone-100 last:border-0">
                      <td className="px-4 py-2 whitespace-nowrap text-stone-600">
                        {dateLabel(p.fecha)}
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-medium text-stone-900">{p.glosa}</p>
                        <p className="text-xs text-stone-400">
                          {ORIGEN_LABEL[p.origen] ?? p.origen} · {p.comprobante}
                          {p.cuenta_nombre ? <> · {p.cuenta_nombre}</> : null}
                          {/* Una cuenta gerencial es plata que no se declara: se
                              avisa acá, antes de apretar «Declarar» sin mirar. */}
                          {p.cuenta_ambito === 'gerencial' ? (
                            <Badge className="ml-1.5 bg-stone-200 text-stone-600">no declara</Badge>
                          ) : null}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-xs text-stone-500">{p.cliente ?? '—'}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {formatMoney(Number(p.debe), 'BOB')}
                      </td>
                      <td className="px-3 py-2">
                        {p.titular === 'tercero' ? (
                          <Badge className="bg-amber-100 text-amber-800">
                            {p.titular_nombre ?? 'un tercero'}
                          </Badge>
                        ) : (
                          <span className="text-xs text-stone-400">la empresa</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => void importarUno(p)}
                          className="rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-light"
                        >
                          Declarar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setExcluyendo(p);
                            setMotivo('');
                          }}
                          className="ml-2 rounded-lg border border-stone-200 px-2.5 py-1 text-xs font-medium text-stone-600 hover:bg-stone-50"
                        >
                          Dejar afuera
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {porImportar.length > 300 ? (
                <p className="px-4 py-3 text-xs text-stone-400">
                  Se muestran los 300 más recientes de {porImportar.length}. Usá «Importar del
                  gerencial» para traer un período entero de una vez.
                </p>
              ) : null}
            </div>
          )}
        </section>
      ) : null}

      {/* ---------- el libro fiscal ---------- */}
      {vista === 'libro' ? (
        <section className="rounded-xl border border-stone-200 bg-white">
          <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 px-4 py-3">
            <p className="text-xs text-stone-500">
              Cada línea dice de qué comprobante del gerencial salió. Las marcadas «sólo fiscal»
              no tienen espejo del otro lado.
            </p>
            <div className="ml-auto flex items-center gap-2">
              {projectId ? (
                <button
                  type="button"
                  className={btnSecondary}
                  onClick={() => setSoloFiscal(true)}
                  title="Un asiento que solo existe en el libro fiscal"
                >
                  Comprobante sólo fiscal
                </button>
              ) : null}
              <ExportButtons
                disabled={!libro.length}
                orientation="landscape"
                meta={{
                  title: 'Libro diario fiscal',
                  subtitle: `Terrenalv S.R.L. · ${projectName}`,
                  filename: `libro-fiscal-${new Date().toISOString().slice(0, 10)}`,
                  footnote:
                    'Contabilidad fiscal: lo declarado. No incluye los movimientos dejados afuera ni los que están a nombre de terceros salvo decisión expresa.',
                }}
                columns={[
                  { header: 'Fecha' },
                  { header: 'Comprobante' },
                  { header: 'Glosa' },
                  { header: 'Cuenta' },
                  { header: 'Debe', align: 'right' },
                  { header: 'Haber', align: 'right' },
                ]}
                rows={() =>
                  libro.map((l) => [
                    dateLabel(l.fecha),
                    l.comprobante,
                    l.glosa,
                    l.cuenta,
                    fnum(Number(l.debe)),
                    fnum(Number(l.haber)),
                  ]) as XCell[][]
                }
              />
            </div>
          </div>
          {libro.length === 0 ? (
            <div className="px-4 py-8">
              <EmptyState
                title="El libro fiscal está vacío"
                hint="Importá del gerencial lo que corresponda declarar."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-stone-200 bg-stone-50 text-left">
                    <th className="px-4 py-2 text-xs font-semibold text-stone-500">Fecha</th>
                    <th className="px-3 py-2 text-xs font-semibold text-stone-500">Comprobante</th>
                    <th className="px-3 py-2 text-xs font-semibold text-stone-500">Glosa</th>
                    <th className="px-3 py-2 text-xs font-semibold text-stone-500">Cuenta</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                      Debe
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                      Haber
                    </th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {libro.slice(0, 500).map((l, i) => (
                    <tr key={`${l.comprobante_id}-${i}`} className="border-b border-stone-100 last:border-0">
                      <td className="px-4 py-2 whitespace-nowrap text-stone-600">
                        {dateLabel(l.fecha)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs font-semibold text-brand">
                        {l.comprobante}
                        {l.solo_fiscal ? (
                          <Badge className="ml-2 bg-stone-200 text-stone-600">sólo fiscal</Badge>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-stone-700">{l.glosa}</td>
                      <td className="px-3 py-2 font-mono text-xs text-stone-500">{l.cuenta}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {Number(l.debe) ? formatMoney(Number(l.debe), 'BOB') : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {Number(l.haber) ? formatMoney(Number(l.haber), 'BOB') : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => void anular(l.comprobante_id, l.comprobante)}
                          className="text-xs text-stone-400 hover:text-red-600"
                          title="Anular este comprobante fiscal"
                        >
                          Anular
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {/* ---------- lo que quedó afuera ---------- */}
      {vista === 'excluidos' ? (
        <section className="rounded-xl border border-stone-200 bg-white">
          {excluidos.length === 0 ? (
            <div className="px-4 py-8">
              <EmptyState
                title="No hay nada dejado afuera"
                hint="Cuando decidas no declarar un movimiento, queda acá con su motivo."
              />
            </div>
          ) : (
            <ul className="divide-y divide-stone-100">
              {excluidos.map((p) => (
                <li
                  key={`${p.origen}-${p.origen_id}`}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-stone-900">{p.glosa}</p>
                    <p className="text-xs text-stone-400">
                      {dateLabel(p.fecha)} · {ORIGEN_LABEL[p.origen] ?? p.origen} ·{' '}
                      {formatMoney(Number(p.debe), 'BOB')}
                    </p>
                    <p className="mt-0.5 text-xs text-amber-700">Motivo: {p.motivo_exclusion}</p>
                  </div>
                  <button
                    type="button"
                    className={btnSecondary}
                    onClick={async () => {
                      const { error } = await supabase.rpc('fiscal_incluir', {
                        p_origen: p.origen,
                        p_origen_id: p.origen_id,
                      });
                      if (error) {
                        push(adminErrorCopy(error.message), 'error');
                        return;
                      }
                      push('Vuelve a estar disponible para declarar.', 'success');
                      void cargar();
                    }}
                  >
                    Volver a considerar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {/* ---------- dejar afuera ---------- */}
      {excluyendo ? (
        <Dialog open onClose={() => setExcluyendo(null)} title="Dejar fuera del libro fiscal">
          <p className="text-sm text-stone-600">
            <strong>{excluyendo.glosa}</strong> — {formatMoney(Number(excluyendo.debe), 'BOB')}.
            No se declara. El movimiento sigue intacto en el gerencial: acá sólo se registra la
            decisión de no declararlo.
          </p>
          <label className="mt-3 mb-1 block text-xs text-stone-500">
            ¿Por qué queda afuera? (queda escrito)
          </label>
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="ej. está a nombre de un tercero, no corresponde a la empresa"
            className={inputClass}
          />
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={btnSecondary} onClick={() => setExcluyendo(null)}>
              Volver
            </button>
            <button
              type="button"
              className={btnPrimary}
              onClick={async () => {
                if (!motivo.trim()) return;
                const { error } = await supabase.rpc('fiscal_excluir', {
                  p_origen: excluyendo.origen,
                  p_origen_id: excluyendo.origen_id,
                  p_motivo: motivo.trim(),
                });
                if (error) {
                  push(adminErrorCopy(error.message), 'error');
                  return;
                }
                push('Queda fuera del libro fiscal, con su motivo.', 'success');
                setExcluyendo(null);
                void cargar();
              }}
            >
              Dejar afuera
            </button>
          </div>
        </Dialog>
      ) : null}

      {/* ---------- importar un período ---------- */}
      {rango ? (
        <Dialog open onClose={() => setRango(null)} title="Importar del gerencial">
          <p className="text-sm text-stone-600">
            Trae al libro fiscal los movimientos del período que todavía no se declararon. Lo que
            ya está no se duplica, y lo dejado afuera no vuelve solo.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-stone-500">Desde</label>
              <input
                type="date"
                value={rango.desde}
                onChange={(e) => setRango({ ...rango, desde: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">Hasta</label>
              <input
                type="date"
                value={rango.hasta}
                onChange={(e) => setRango({ ...rango, hasta: e.target.value })}
                className={inputClass}
              />
            </div>
          </div>
          <label className="mt-3 flex items-start gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={rango.terceros}
              onChange={(e) => setRango({ ...rango, terceros: e.target.checked })}
              className="mt-0.5"
            />
            <span>
              Incluir también lo que está <strong>a nombre de terceros</strong>
              <span className="block text-xs text-stone-400">
                Por defecto no entran. Declarar algo ajeno tiene que ser una decisión, no el
                resultado de apretar un botón sin mirar.
              </span>
            </span>
          </label>
          <label className="mt-3 flex items-start gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={rango.cuentasGerenciales}
              onChange={(e) => setRango({ ...rango, cuentasGerenciales: e.target.checked })}
              className="mt-0.5"
            />
            <span>
              Incluir <strong>cuentas que no declaran</strong>
              <span className="block text-xs text-stone-400">
                Movimientos asentados en cuentas marcadas como gerenciales. Por defecto se
                saltean: lo que no se declara no entra al libro fiscal por accidente.
              </span>
            </span>
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={btnSecondary} onClick={() => setRango(null)}>
              Volver
            </button>
            <button
              type="button"
              className={btnPrimary}
              disabled={importando}
              onClick={async () => {
                setImportando(true);
                const { data, error } = await supabase.rpc('fiscal_importar', {
                  p_project_id: projectId,
                  p_desde: rango.desde,
                  p_hasta: rango.hasta,
                  p_incluir_terceros: rango.terceros,
                  p_incluir_cuentas_gerenciales: rango.cuentasGerenciales,
                });
                setImportando(false);
                if (error) {
                  push(adminErrorCopy(error.message), 'error');
                  return;
                }
                const d = data as {
                  traidos?: number;
                  saltados_tercero?: number;
                  saltados_excluidos?: number;
                  saltados_cuenta?: number;
                } | null;
                push(
                  `Se declararon ${d?.traidos ?? 0} movimiento(s).` +
                    (d?.saltados_tercero
                      ? ` Quedaron ${d.saltados_tercero} de terceros sin declarar.`
                      : '') +
                    (d?.saltados_excluidos
                      ? ` ${d.saltados_excluidos} estaban dejados afuera.`
                      : '') +
                    (d?.saltados_cuenta
                      ? ` ${d.saltados_cuenta} van a cuentas que no declaran y quedaron afuera.`
                      : ''),
                  'success',
                );
                setRango(null);
                void cargar();
              }}
            >
              {importando ? 'Importando…' : 'Importar'}
            </button>
          </div>
        </Dialog>
      ) : null}

      {/* ---------- comprobante sólo fiscal ---------- */}
      {soloFiscal && projectId ? (
        <ComprobanteSoloFiscal
          projectId={projectId}
          onClose={() => setSoloFiscal(false)}
          onSaved={() => void cargar()}
        />
      ) : null}
    </div>
  );
}
