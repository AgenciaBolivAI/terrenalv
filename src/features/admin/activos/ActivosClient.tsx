'use client';

// ACTIVOS FIJOS — lo que se compra y no se gasta de una.
//
// Una camioneta, una retroexcavadora, las computadoras. Desde ahora registrar
// un activo ASIENTA su compra —antes no asentaba nada, y la depreciación
// acumulada crecía contra un activo que el balance nunca había reconocido—, y
// la baja asienta su salida con la ganancia o la pérdida.
//
// La lista se filtra por urbanización como el resto del panel: antes mostraba
// todos los activos de todas, aunque arriba dijera otra cosa.

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
import { ExportButtons } from '@/features/admin/export/ExportButtons';
import { num, type Cell } from '@/features/admin/export';
import { dateLabel, todayIso } from '@/features/admin/contabilidad/types';
import { CuentaSelect, useTesoreria } from '@/features/admin/contabilidad/Tesoreria';
import { ScopeBar, type ProjectScope } from '@/features/admin/ui/scope';
import type { AdminProject } from '@/features/admin/lib/project-types';
import { ActivoDialog } from './ActivoDialog';
import { ActivoKardex } from './ActivoKardex';
import { ESTADO_ACTIVO, type Activo, type Categoria } from './tipos';

/** Qué se está mirando de la lista. Los KPI de arriba lo cambian. */
type Filtro = 'todos' | 'vivos' | 'depreciando' | 'bajas';

export default function ActivosClient({
  projectId,
  projects,
}: {
  projectId: string;
  projects: AdminProject[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();

  const [scope, setScope] = useState<ProjectScope>(projects.length > 1 ? null : projectId);
  const [rows, setRows] = useState<Activo[]>([]);
  const [cats, setCats] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [depreciando, setDepreciando] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>('todos');

  const [editando, setEditando] = useState<Activo | null | 'nuevo'>(null);
  const [kardex, setKardex] = useState<Activo | null>(null);
  const [dandoBaja, setDandoBaja] = useState<Activo | null>(null);

  const cargar = useCallback(async () => {
    let q = supabase.from('v_activos_fijos').select('*');
    if (scope !== null) q = q.eq('project_id', scope);
    const [a, c] = await Promise.all([
      q.order('codigo'),
      supabase
        .from('asset_categories')
        .select('id, codigo, nombre, vida_util_meses, cuenta_activo')
        .eq('is_active', true)
        .order('sort_order'),
    ]);
    setRows((a.data ?? []) as unknown as Activo[]);
    setCats((c.data ?? []) as unknown as Categoria[]);
    setLoading(false);
  }, [supabase, scope]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const vivos = useMemo(() => rows.filter((r) => r.estado === 'activo'), [rows]);
  const totales = useMemo(
    () => ({
      costo: vivos.reduce((s, r) => s + Number(r.costo), 0),
      libros: vivos.reduce((s, r) => s + Number(r.valor_en_libros), 0),
      mensual: vivos
        .filter((r) => !r.totalmente_depreciado)
        .reduce((s, r) => s + Number(r.mensual), 0),
    }),
    [vivos],
  );

  const visibles = useMemo(() => {
    switch (filtro) {
      case 'vivos': return rows.filter((r) => r.estado === 'activo');
      case 'depreciando': return rows.filter((r) => r.estado === 'activo' && !r.totalmente_depreciado);
      case 'bajas': return rows.filter((r) => r.estado !== 'activo');
      default: return rows;
    }
  }, [rows, filtro]);

  async function depreciarMes() {
    if (scope === null) return;
    const hoy = new Date();
    setDepreciando(true);
    const { data, error } = await supabase.rpc('admin_depreciar_mes', {
      p_project_id: scope,
      p_anio: hoy.getFullYear(),
      p_mes: hoy.getMonth() + 1,
    });
    setDepreciando(false);
    if (error) {
      push(adminErrorCopy(error.message), 'error');
      return;
    }
    const d = data as { activos?: number; total?: number; comprobante?: string } | null;
    push(
      `Depreciación contabilizada: ${d?.activos ?? 0} activo(s), ${formatMoney(
        Number(d?.total ?? 0),
        'BOB',
      )} — comprobante ${d?.comprobante ?? ''}.`,
      'success',
    );
    void cargar();
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  const nombreAlcance =
    scope === null ? 'Todas las urbanizaciones' : (projects.find((p) => p.id === scope)?.name ?? '');

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-lg font-bold text-stone-900">Activos fijos</h1>
        <p className="text-xs text-stone-500">
          Lo que se compró y se va gastando con los años. La depreciación la calcula el sistema.
        </p>
        <div className="ml-auto flex gap-2">
          <ExportButtons
            disabled={!visibles.length}
            orientation="landscape"
            meta={{
              title: 'Activos Fijos',
              subtitle: nombreAlcance,
              filename: `activos-fijos-${todayIso()}`,
              footnote: 'Línea recta: (costo − residual) ÷ meses de vida útil.',
            }}
            columns={[
              { header: 'Código' }, { header: 'Nombre' }, { header: 'Categoría' },
              { header: 'Proveedor' }, { header: 'Factura' }, { header: 'Compra' },
              { header: 'Costo', align: 'right' }, { header: 'Depreciado', align: 'right' },
              { header: 'En libros', align: 'right' }, { header: 'Estado' },
            ]}
            rows={() =>
              visibles.map((r) => [
                r.codigo, r.nombre, r.categoria,
                r.proveedor ?? '', r.numero_factura ?? '', dateLabel(r.fecha_compra),
                num(Number(r.costo)), num(Number(r.acumulada)), num(Number(r.valor_en_libros)),
                ESTADO_ACTIVO[r.estado] ?? r.estado,
              ]) as Cell[][]
            }
          />
          <button
            type="button"
            className={btnSecondary}
            disabled={depreciando || scope === null}
            title={
              scope === null
                ? 'Elegí una urbanización: la depreciación se asienta en una gestión concreta.'
                : undefined
            }
            onClick={() => void depreciarMes()}
          >
            {depreciando ? 'Contabilizando…' : 'Contabilizar depreciación del mes'}
          </button>
          <button type="button" className={btnPrimary} onClick={() => setEditando('nuevo')}>
            Nuevo activo
          </button>
        </div>
      </div>

      <ScopeBar projects={projects} scope={scope} onScope={setScope} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Activos vivos"
          value={String(vivos.length)}
          hint="en uso, sin dar de baja"
          onClick={() => setFiltro('vivos')}
        />
        <Kpi
          label="Costo de compra"
          value={formatMoney(totales.costo, 'BOB')}
          hint="lo que se pagó por todos"
          onClick={() => setFiltro('vivos')}
        />
        <Kpi
          label="Valor en libros"
          value={formatMoney(totales.libros, 'BOB')}
          tone="good"
          hint="costo menos lo ya depreciado"
          onClick={() => setFiltro('vivos')}
        />
        <Kpi
          label="Depreciación mensual"
          value={formatMoney(totales.mensual, 'BOB')}
          hint="lo que se gasta cada mes"
          onClick={() => setFiltro('depreciando')}
        />
      </div>

      <section className="rounded-xl border border-stone-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-stone-100 px-4 py-2.5">
          {([
            ['todos', `Todos (${rows.length})`],
            ['vivos', `En uso (${vivos.length})`],
            ['bajas', `Dados de baja (${rows.length - vivos.length})`],
          ] as [Filtro, string][]).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFiltro(id)}
              className={`cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filtro === id ? 'bg-brand text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {!visibles.length ? (
          <div className="px-4 py-8">
            <EmptyState
              title={rows.length ? 'Nada en este filtro' : 'Todavía no hay activos registrados'}
              hint={
                rows.length
                  ? 'Probá con otro filtro.'
                  : 'Cargá la camioneta, la maquinaria o las computadoras: la compra se asienta sola y la depreciación sale del sistema.'
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-250 text-sm">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50 text-left">
                  <th className="px-4 py-2 text-xs font-semibold text-stone-500">Activo</th>
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">Proveedor y factura</th>
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">Categoría</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Costo</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Mensual</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Depreciado</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">En libros</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Le quedan</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {visibles.map((r) => {
                  const vencida =
                    r.forma_pago === 'credito' &&
                    !r.pagado_el &&
                    r.vencimiento !== null &&
                    r.vencimiento < todayIso();
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setKardex(r)}
                      className={`cursor-pointer border-b border-stone-100 last:border-0 hover:bg-stone-50 ${
                        r.estado !== 'activo' ? 'opacity-55' : ''
                      }`}
                    >
                      <td className="px-4 py-2">
                        <p className="font-medium text-stone-900">
                          <span className="font-mono text-xs text-brand">{r.codigo}</span> · {r.nombre}
                        </p>
                        <p className="text-xs text-stone-400">
                          {dateLabel(r.fecha_alta)}
                          {r.identificacion ? ` · ${r.identificacion}` : ''}
                          {r.estado !== 'activo' ? ` · ${ESTADO_ACTIVO[r.estado] ?? r.estado}` : ''}
                          {scope === null && r.proyecto ? ` · ${r.proyecto}` : ''}
                        </p>
                        {r.titular === 'tercero' ? (
                          <Badge className="mt-0.5 bg-amber-100 text-amber-800">
                            a nombre de {r.titular_nombre}
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-xs text-stone-600">
                        {r.proveedor ?? <span className="text-stone-400">sin proveedor</span>}
                        {r.numero_factura ? (
                          <span className="block text-stone-400">Fact. {r.numero_factura}</span>
                        ) : null}
                        {r.forma_pago === 'credito' && !r.pagado_el ? (
                          <Badge
                            className={`mt-0.5 ${
                              vencida ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            a crédito · {vencida ? 'vencida' : 'vence'}{' '}
                            {r.vencimiento ? dateLabel(r.vencimiento) : ''}
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-xs text-stone-500">{r.categoria}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-stone-600">
                        {formatMoney(Number(r.costo), 'BOB')}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-stone-600">
                        {r.totalmente_depreciado ? '—' : formatMoney(Number(r.mensual), 'BOB')}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-stone-600">
                        {formatMoney(Number(r.acumulada), 'BOB')}
                        <span className="block text-[11px] text-stone-400">
                          {r.meses_corridos}/{r.vida_util_meses} meses
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-stone-900">
                        {formatMoney(Number(r.valor_en_libros), 'BOB')}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-stone-500">
                        {r.totalmente_depreciado ? (
                          <Badge className="bg-stone-200 text-stone-600">depreciado</Badge>
                        ) : (
                          `${r.meses_restantes} m.`
                        )}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {r.estado === 'activo' ? (
                          <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                            <button type="button" className={btnSecondary} onClick={() => setEditando(r)}>
                              Editar
                            </button>
                            <button
                              type="button"
                              className="cursor-pointer text-xs text-stone-400 hover:text-red-600"
                              onClick={() => setDandoBaja(r)}
                            >
                              Dar de baja
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="border-t border-stone-100 px-4 py-2.5 text-xs text-stone-400">
          Línea recta: (costo − residual) ÷ meses de vida útil. Las vidas útiles de cada categoría
          vienen de la práctica boliviana (vehículos 5 años, computación 4, maquinaria 8, muebles
          10, edificaciones 40) y son editables — confirmalas con el contador antes de cerrar
          gestión. Tocá una fila para ver su kardex.
        </p>
      </section>

      {editando ? (
        <ActivoDialog
          activo={editando === 'nuevo' ? null : editando}
          cats={cats}
          projects={projects}
          defaultProjectId={scope ?? projectId}
          onClose={() => setEditando(null)}
          onSaved={() => {
            setEditando(null);
            setKardex(null);
            void cargar();
          }}
        />
      ) : null}

      {kardex ? (
        <ActivoKardex
          activo={kardex}
          onClose={() => setKardex(null)}
          onEditar={() => {
            const a = kardex;
            setKardex(null);
            setEditando(a);
          }}
        />
      ) : null}

      {dandoBaja ? (
        <BajaDialog
          activo={dandoBaja}
          onClose={() => setDandoBaja(null)}
          onHecho={() => {
            setDandoBaja(null);
            void cargar();
          }}
          push={push}
        />
      ) : null}
    </div>
  );
}

/**
 * Dar de baja: antes era un `window.prompt` que pedía el motivo y decía «si se
 * vendió, después cargá el valor desde contabilidad» — o sea, a mano y en otro
 * lado. Ahora la venta entra acá y el asiento sale completo: se cancela la
 * depreciación acumulada, entra la plata y se reconoce la ganancia o la
 * pérdida.
 */
function BajaDialog({
  activo,
  onClose,
  onHecho,
  push,
}: {
  activo: Activo;
  onClose: () => void;
  onHecho: () => void;
  push: (m: string, t?: 'success' | 'error') => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { cuentas } = useTesoreria();
  const [fecha, setFecha] = useState(todayIso);
  const [motivo, setMotivo] = useState('');
  const [seVendio, setSeVendio] = useState(false);
  const [valorVenta, setValorVenta] = useState('');
  const [cuentaId, setCuentaId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enLibros = Number(activo.valor_en_libros);
  const resultado = seVendio ? Number(valorVenta || 0) - enLibros : -enLibros;

  async function guardar() {
    setError(null);
    if (!motivo.trim()) {
      setError('Decinos por qué se da de baja.');
      return;
    }
    if (seVendio && !(Number(valorVenta) > 0)) {
      setError('Si se vendió, el valor de venta tiene que ser mayor a cero.');
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.rpc('admin_dar_de_baja_activo', {
      p_id: activo.id,
      p_fecha: fecha,
      p_motivo: motivo.trim(),
      p_valor_venta: seVendio ? Number(valorVenta) : null,
      p_venta_treasury_account_id: seVendio ? cuentaId || null : null,
    });
    setBusy(false);
    if (err) {
      setError(adminErrorCopy(err.message));
      return;
    }
    push('Activo dado de baja. Deja de depreciar y sale del activo.', 'success');
    onHecho();
  }

  return (
    <Dialog open onClose={onClose} title={`Dar de baja — ${activo.codigo} · ${activo.nombre}`}>
      <div className="space-y-3">
        <div className="rounded-lg bg-stone-50 p-3 text-sm">
          <p className="text-xs text-stone-600">
            Costo {formatMoney(Number(activo.costo), 'BOB')} · depreciado{' '}
            {formatMoney(Number(activo.acumulada), 'BOB')}
          </p>
          <p className="mt-1 font-semibold text-stone-900">
            Vale {formatMoney(enLibros, 'BOB')} en libros
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Fecha de la baja</label>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">¿Se vendió?</label>
            <select
              value={seVendio ? 'si' : 'no'}
              onChange={(e) => setSeVendio(e.target.value === 'si')}
              className={inputClass}
            >
              <option value="no">No, se dio de baja</option>
              <option value="si">Sí, se vendió</option>
            </select>
          </div>
        </div>

        <input
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Motivo (ej. se vendió a un tercero, quedó inservible)"
          className={inputClass}
        />

        {seVendio ? (
          <>
            <div>
              <label className="mb-1 block text-xs text-stone-500">Valor de venta (Bs)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={valorVenta}
                onChange={(e) => setValorVenta(e.target.value)}
                className={inputClass}
              />
            </div>
            <CuentaSelect
              cuentas={cuentas}
              value={cuentaId}
              onChange={setCuentaId}
              label="¿A qué caja o banco entró la plata?"
              monto={Number(valorVenta)}
              signo={1}
            />
          </>
        ) : null}

        <p className="rounded-lg bg-stone-50 p-2.5 text-[11px] text-stone-600">
          El asiento cancela la depreciación acumulada y saca el activo por su costo.
          {seVendio && Number(valorVenta) > 0 ? (
            resultado >= 0 ? (
              <> Como se vendió por más de lo que vale en libros, reconoce una <strong>ganancia
              de {formatMoney(resultado, 'BOB')}</strong> en 4.02.01.020.</>
            ) : (
              <> Como se vendió por menos de lo que vale en libros, reconoce una <strong>pérdida
              de {formatMoney(Math.abs(resultado), 'BOB')}</strong> en 5.02.03.010.</>
            )
          ) : (
            <> Lo que quede sin depreciar —{formatMoney(enLibros, 'BOB')}— va como pérdida a
            5.02.03.010.</>
          )}
        </p>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Volver
        </button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void guardar()}>
          {busy ? 'Guardando…' : 'Dar de baja'}
        </button>
      </div>
    </Dialog>
  );
}
