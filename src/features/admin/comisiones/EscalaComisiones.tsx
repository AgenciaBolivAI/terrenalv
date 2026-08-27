'use client';

// La escala de comisiones del Directorio, editable desde el panel.
//
// El % no lo escribe nadie por venta: sale de CUÁNTAS ventas lleva el asesor
// y de si vendió al contado o a plazo. Y es retroactiva — al llegar a la
// séptima venta a plazo no cobra 1,2% de la séptima y 1% de las seis
// anteriores: cobra 1,2% de las siete. Por eso el documento muestra
// 153,60 × 7 = 1.075,20 como piso del tramo.
//
// Se edita acá porque las políticas 6 y 7 lo dicen: la cantidad la mueve
// Gerencia General y el % es atribución del Directorio.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/format';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';
import { Badge, Spinner, btnPrimary, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { Dialog } from '@/features/admin/ui/dialog';
import { useToast } from '@/features/admin/ui/toast';

interface Tramo {
  id: string;
  gestion: number;
  modalidad: 'contado' | 'plazo';
  desde: number;
  hasta: number | null;
  pct_inicial: number;
  pct_reintegro: number;
  is_active: boolean;
}

interface Politica {
  gestion: number;
  periodo: 'gestion' | 'mes';
  cuota_reintegro: number;
  split_compartida_pct: number;
  bono_equipo_mensual: number;
  bono_personal_semanal: number;
  ventas_objetivo_semanal: number;
  notas: string | null;
}

const MODALIDAD_LABEL: Record<string, string> = {
  plazo: 'Ventas a plazo',
  contado: 'Ventas al contado',
};

export default function EscalaComisiones() {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const gestion = new Date().getFullYear();

  const [tramos, setTramos] = useState<Tramo[]>([]);
  const [pol, setPol] = useState<Politica | null>(null);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<Partial<Tramo> | null>(null);
  const [editPol, setEditPol] = useState<Politica | null>(null);

  // Un lote de prueba, para ver la escala en plata y no en porcentajes.
  const [simLote, setSimLote] = useState('12800');
  const [simVentas, setSimVentas] = useState('7');

  const cargar = useCallback(async () => {
    const [t, p] = await Promise.all([
      supabase
        .from('commission_scales')
        .select('*')
        .eq('gestion', gestion)
        .order('modalidad')
        .order('desde'),
      supabase.from('commission_policy').select('*').eq('gestion', gestion).maybeSingle(),
    ]);
    setTramos((t.data ?? []) as unknown as Tramo[]);
    setPol((p.data as Politica | null) ?? null);
    setLoading(false);
  }, [supabase, gestion]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const porModalidad = (m: 'contado' | 'plazo') =>
    tramos.filter((t) => t.modalidad === m).sort((a, b) => a.desde - b.desde);

  /** El tramo donde cae una cantidad de ventas. Misma regla que la base. */
  const tramoDe = (m: 'contado' | 'plazo', n: number) =>
    porModalidad(m).find((t) => t.is_active && n >= t.desde && (t.hasta === null || n <= t.hasta));

  async function guardar() {
    if (!edit) return;
    const { error } = await supabase.rpc('admin_guardar_escala', {
      p_id: edit.id ?? null,
      p_gestion: edit.gestion ?? gestion,
      p_modalidad: edit.modalidad,
      p_desde: Number(edit.desde) || 1,
      p_hasta: edit.hasta === null || edit.hasta === undefined ? null : Number(edit.hasta),
      p_pct_inicial: Number(edit.pct_inicial) || 0,
      p_pct_reintegro: Number(edit.pct_reintegro) || 0,
      p_activo: edit.is_active ?? true,
    });
    if (error) {
      push(adminErrorCopy(error.message), 'error');
      return;
    }
    push('Tramo guardado.', 'success');
    setEdit(null);
    void cargar();
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  const lote = Number(simLote) || 0;
  const nVentas = Number(simVentas) || 0;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="text-sm font-bold text-stone-900">
          Escala de comisiones — gestión {gestion}
        </h2>
        <p className="mt-1 text-xs text-stone-500">
          El porcentaje sale de cuántas ventas lleva el asesor y de cómo vendió, y se aplica{' '}
          <strong>sobre el valor de cada lote</strong> — por eso 1% de un lote de Bs 1.000 y 1% de
          uno de Bs 10.000 no son lo mismo. Es <strong>retroactiva</strong>: al alcanzar un tramo,
          ese porcentaje se aplica a todas sus ventas del período, no sólo a la que lo desbloqueó.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {(['plazo', 'contado'] as const).map((m) => (
          <section key={m} className="rounded-xl border border-stone-200 bg-white">
            <div className="flex items-center gap-3 border-b border-stone-200 px-4 py-3">
              <h3 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                {MODALIDAD_LABEL[m]}
              </h3>
              <button
                type="button"
                className={`${btnSecondary} ml-auto`}
                onClick={() =>
                  setEdit({
                    modalidad: m,
                    gestion,
                    desde: (porModalidad(m).at(-1)?.hasta ?? 0) + 1,
                    hasta: null,
                    pct_inicial: 0,
                    pct_reintegro: m === 'plazo' ? 0 : 0,
                    is_active: true,
                  })
                }
              >
                Agregar tramo
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-200 bg-stone-50 text-left">
                    <th className="px-4 py-2 text-xs font-semibold text-stone-500">Ventas</th>
                    {m === 'plazo' ? (
                      <>
                        <th className="px-2 py-2 text-right text-xs font-semibold text-stone-500">
                          Al completar la inicial
                        </th>
                        <th className="px-2 py-2 text-right text-xs font-semibold text-stone-500">
                          Al completar la {pol?.cuota_reintegro ?? 4}ª
                        </th>
                      </>
                    ) : null}
                    <th className="px-2 py-2 text-right text-xs font-semibold text-stone-500">
                      Total
                    </th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {porModalidad(m).map((t) => (
                    <tr key={t.id} className="border-b border-stone-100 last:border-0">
                      <td className="px-4 py-2 tabular-nums text-stone-800">
                        {t.desde} {t.hasta === null ? 'y más' : `a ${t.hasta}`}
                        {!t.is_active ? (
                          <Badge className="ml-2 bg-stone-200 text-stone-600">inactivo</Badge>
                        ) : null}
                      </td>
                      {m === 'plazo' ? (
                        <>
                          <td className="px-2 py-2 text-right tabular-nums text-stone-600">
                            {Number(t.pct_inicial)}%
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums text-stone-600">
                            {Number(t.pct_reintegro)}%
                          </td>
                        </>
                      ) : null}
                      <td className="px-2 py-2 text-right font-semibold tabular-nums text-brand">
                        {(Number(t.pct_inicial) + Number(t.pct_reintegro)).toFixed(2)}%
                      </td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          className="text-xs font-medium text-stone-600 hover:text-brand"
                          onClick={() => setEdit(t)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="ml-2 text-xs text-stone-400 hover:text-red-600"
                          onClick={async () => {
                            const { error } = await supabase.rpc('admin_borrar_escala', {
                              p_id: t.id,
                            });
                            if (error) {
                              push(adminErrorCopy(error.message), 'error');
                              return;
                            }
                            push('Tramo borrado.', 'success');
                            void cargar();
                          }}
                        >
                          Quitar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>

      {/* ---------- El simulador: la escala en plata ---------- */}
      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h3 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
          Cuánto sería
        </h3>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Valor del lote (Bs)</label>
            <input
              type="number"
              min={0}
              value={simLote}
              onChange={(e) => setSimLote(e.target.value)}
              className={`${inputClass} w-40`}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">Ventas del asesor</label>
            <input
              type="number"
              min={1}
              value={simVentas}
              onChange={(e) => setSimVentas(e.target.value)}
              className={`${inputClass} w-32`}
            />
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(['plazo', 'contado'] as const).map((m) => {
            const t = tramoDe(m, nVentas);
            const pct = t ? Number(t.pct_inicial) + Number(t.pct_reintegro) : 0;
            const porLote = Math.round(((lote * pct) / 100) * 100) / 100;
            return (
              <div key={m} className="rounded-lg border border-stone-200 p-3">
                <p className="text-xs font-semibold text-stone-500">{MODALIDAD_LABEL[m]}</p>
                {t ? (
                  <>
                    <p className="mt-1 text-sm text-stone-700">
                      Con {nVentas} venta{nVentas === 1 ? '' : 's'} está en el tramo{' '}
                      <strong>
                        {t.desde}
                        {t.hasta === null ? ' y más' : `–${t.hasta}`}
                      </strong>{' '}
                      → <strong className="text-brand">{pct.toFixed(2)}%</strong>
                    </p>
                    <p className="mt-1 text-lg font-bold tabular-nums text-stone-900">
                      {formatMoney(porLote, 'BOB')}{' '}
                      <span className="text-xs font-normal text-stone-400">por lote</span>
                    </p>
                    <p className="text-xs text-stone-500">
                      Acumulado por sus {nVentas}:{' '}
                      <strong>{formatMoney(porLote * nVentas, 'BOB')}</strong>
                    </p>
                    {m === 'plazo' && Number(t.pct_reintegro) > 0 ? (
                      <p className="mt-1 text-xs text-stone-400">
                        Se cobra en dos mitades: {formatMoney(
                          Math.round(((lote * Number(t.pct_inicial)) / 100) * 100) / 100,
                          'BOB',
                        )}{' '}
                        al completar la cuota inicial y el resto al completar la cuota{' '}
                        {pol?.cuota_reintegro ?? 4}.
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-stone-400">
                        Paga todo de una, así que la comisión se cobra entera a la firma del
                        contrato.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="mt-1 text-sm text-red-600">
                    No hay tramo para esa cantidad — el asesor cobraría cero.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ---------- Las políticas de la gestión ---------- */}
      {pol ? (
        <section className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
              Políticas de la gestión
            </h3>
            <button
              type="button"
              className={`${btnSecondary} ml-auto`}
              onClick={() => setEditPol(pol)}
            >
              Editar políticas
            </button>
          </div>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-xs text-stone-500">La cantidad se cuenta por</dt>
              <dd className="font-medium text-stone-800">
                {pol.periodo === 'mes' ? 'mes' : 'toda la gestión'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-stone-500">El reintegro se gana en la cuota</dt>
              <dd className="font-medium text-stone-800">N° {pol.cuota_reintegro}</dd>
            </div>
            <div>
              <dt className="text-xs text-stone-500">Venta compartida</dt>
              <dd className="font-medium text-stone-800">
                {Number(pol.split_compartida_pct)}% para cada asesor
              </dd>
            </div>
            <div>
              <dt className="text-xs text-stone-500">Bono de equipo (mensual)</dt>
              <dd className="font-medium text-stone-800">
                {formatMoney(Number(pol.bono_equipo_mensual), 'BOB')}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-stone-500">Bono personal (semanal)</dt>
              <dd className="font-medium text-stone-800">
                {formatMoney(Number(pol.bono_personal_semanal), 'BOB')} ·{' '}
                {pol.ventas_objetivo_semanal} ventas
              </dd>
            </div>
          </dl>
          {pol.notas ? <p className="mt-3 text-xs text-stone-400">{pol.notas}</p> : null}
          <p className="mt-3 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-500">
            Los bonos y el reparto de la venta compartida están guardados como parámetro de la
            gestión, pero todavía <strong>no se liquidan solos</strong>: hoy se pagan como
            cualquier otro egreso de comisiones.
          </p>
        </section>
      ) : null}

      {/* ---------- Editar un tramo ---------- */}
      {edit ? (
        <Dialog
          open
          onClose={() => setEdit(null)}
          title={edit.id ? 'Editar tramo' : 'Nuevo tramo'}
        >
          <p className="text-sm text-stone-600">
            {MODALIDAD_LABEL[edit.modalidad ?? 'plazo']} · gestión {edit.gestion ?? gestion}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-stone-500">Desde (ventas)</label>
              <input
                type="number"
                min={1}
                value={edit.desde ?? 1}
                onChange={(e) => setEdit({ ...edit, desde: Number(e.target.value) })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">Hasta (vacío = y más)</label>
              <input
                type="number"
                min={1}
                value={edit.hasta ?? ''}
                onChange={(e) =>
                  setEdit({ ...edit, hasta: e.target.value === '' ? null : Number(e.target.value) })
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">
                {edit.modalidad === 'plazo'
                  ? '% al completar la cuota inicial'
                  : '% a la firma del contrato'}
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={edit.pct_inicial ?? 0}
                onChange={(e) => setEdit({ ...edit, pct_inicial: Number(e.target.value) })}
                className={inputClass}
              />
            </div>
            {edit.modalidad === 'plazo' ? (
              <div>
                <label className="mb-1 block text-xs text-stone-500">
                  % al completar la cuota {pol?.cuota_reintegro ?? 4}
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={edit.pct_reintegro ?? 0}
                  onChange={(e) => setEdit({ ...edit, pct_reintegro: Number(e.target.value) })}
                  className={inputClass}
                />
              </div>
            ) : null}
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={edit.is_active ?? true}
              onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })}
            />
            Activo
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={btnSecondary} onClick={() => setEdit(null)}>
              Volver
            </button>
            <button type="button" className={btnPrimary} onClick={() => void guardar()}>
              Guardar
            </button>
          </div>
        </Dialog>
      ) : null}

      {/* ---------- Editar políticas ---------- */}
      {editPol ? (
        <Dialog open onClose={() => setEditPol(null)} title="Políticas de la gestión">
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-stone-500">
                La cantidad de ventas se cuenta por
              </label>
              <select
                value={editPol.periodo}
                onChange={(e) =>
                  setEditPol({ ...editPol, periodo: e.target.value as 'gestion' | 'mes' })
                }
                className={inputClass}
              >
                <option value="gestion">Toda la gestión (se acumula todo el año)</option>
                <option value="mes">Mes a mes (arranca de cero cada mes)</option>
              </select>
              <p className="mt-1 text-xs text-stone-400">
                Cambia mucho la plata: acumulando todo el año el asesor sube de tramo y se queda
                arriba; mes a mes vuelve a empezar cada mes.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-stone-500">Cuota del reintegro</label>
                <input
                  type="number"
                  min={1}
                  value={editPol.cuota_reintegro}
                  onChange={(e) =>
                    setEditPol({ ...editPol, cuota_reintegro: Number(e.target.value) })
                  }
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-stone-500">Venta compartida (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={editPol.split_compartida_pct}
                  onChange={(e) =>
                    setEditPol({ ...editPol, split_compartida_pct: Number(e.target.value) })
                  }
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-stone-500">Bono equipo (mensual)</label>
                <input
                  type="number"
                  min={0}
                  value={editPol.bono_equipo_mensual}
                  onChange={(e) =>
                    setEditPol({ ...editPol, bono_equipo_mensual: Number(e.target.value) })
                  }
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-stone-500">Bono personal (semanal)</label>
                <input
                  type="number"
                  min={0}
                  value={editPol.bono_personal_semanal}
                  onChange={(e) =>
                    setEditPol({ ...editPol, bono_personal_semanal: Number(e.target.value) })
                  }
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-stone-500">Ventas objetivo semanal</label>
                <input
                  type="number"
                  min={0}
                  value={editPol.ventas_objetivo_semanal}
                  onChange={(e) =>
                    setEditPol({ ...editPol, ventas_objetivo_semanal: Number(e.target.value) })
                  }
                  className={inputClass}
                />
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={btnSecondary} onClick={() => setEditPol(null)}>
              Volver
            </button>
            <button
              type="button"
              className={btnPrimary}
              onClick={async () => {
                const { error } = await supabase.rpc('admin_guardar_politica_comision', {
                  p_gestion: editPol.gestion,
                  p_periodo: editPol.periodo,
                  p_cuota_reintegro: editPol.cuota_reintegro,
                  p_split_compartida_pct: editPol.split_compartida_pct,
                  p_bono_equipo_mensual: editPol.bono_equipo_mensual,
                  p_bono_personal_semanal: editPol.bono_personal_semanal,
                  p_ventas_objetivo_semanal: editPol.ventas_objetivo_semanal,
                  p_notas: null,
                });
                if (error) {
                  push(adminErrorCopy(error.message), 'error');
                  return;
                }
                push('Políticas guardadas.', 'success');
                setEditPol(null);
                void cargar();
              }}
            >
              Guardar
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
