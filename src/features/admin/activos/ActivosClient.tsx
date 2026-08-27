'use client';

// ACTIVOS FIJOS — lo que se compra y no se gasta de una.
//
// Una camioneta, una retroexcavadora, las computadoras. La depreciación la
// calcula el sistema en línea recta y el asiento del mes se contabiliza con
// un botón: 5811 contra 1290, un renglón por activo.

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

interface Activo {
  id: string;
  project_id: string | null;
  proyecto: string | null;
  codigo: string;
  nombre: string;
  identificacion: string | null;
  categoria: string;
  categoria_codigo: string;
  fecha_compra: string;
  fecha_alta: string;
  costo: number;
  valor_residual: number;
  vida_util_meses: number;
  estado: string;
  mensual: number;
  meses_corridos: number;
  acumulada: number;
  valor_en_libros: number;
  meses_restantes: number;
  totalmente_depreciado: boolean;
  centro_costo: string | null;
  titular: string;
  titular_nombre: string | null;
}

interface Categoria {
  id: string;
  codigo: string;
  nombre: string;
  vida_util_meses: number;
}

export default function ActivosClient() {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const { projectId } = useAdmin();

  const [rows, setRows] = useState<Activo[]>([]);
  const [cats, setCats] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null);
  const [depreciando, setDepreciando] = useState(false);

  const cargar = useCallback(async () => {
    const [a, c] = await Promise.all([
      supabase.from('v_activos_fijos').select('*').order('codigo'),
      supabase
        .from('asset_categories')
        .select('id, codigo, nombre, vida_util_meses')
        .eq('is_active', true)
        .order('sort_order'),
    ]);
    setRows((a.data ?? []) as unknown as Activo[]);
    setCats((c.data ?? []) as unknown as Categoria[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const activos = useMemo(() => rows.filter((r) => r.estado === 'activo'), [rows]);
  const totales = useMemo(
    () => ({
      costo: activos.reduce((s, r) => s + Number(r.costo), 0),
      libros: activos.reduce((s, r) => s + Number(r.valor_en_libros), 0),
      mensual: activos
        .filter((r) => !r.totalmente_depreciado)
        .reduce((s, r) => s + Number(r.mensual), 0),
    }),
    [activos],
  );

  async function depreciarMes() {
    const hoy = new Date();
    setDepreciando(true);
    const { data, error } = await supabase.rpc('admin_depreciar_mes', {
      p_project_id: projectId,
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
        <h1 className="text-lg font-bold text-stone-900">Activos fijos</h1>
        <p className="text-xs text-stone-500">
          Lo que se compró y se va gastando con los años. La depreciación la calcula el sistema.
        </p>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className={btnSecondary}
            disabled={depreciando}
            onClick={() => void depreciarMes()}
          >
            {depreciando ? 'Contabilizando…' : 'Contabilizar depreciación del mes'}
          </button>
          <button
            type="button"
            className={btnPrimary}
            onClick={() =>
              setEdit({
                fecha_compra: new Date().toISOString().slice(0, 10),
                titular: 'empresa',
                valor_residual: 0,
              })
            }
          >
            Nuevo activo
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Activos vivos"
          value={String(activos.length)}
          hint="en uso, sin dar de baja"
          onClick={() => undefined}
        />
        <Kpi
          label="Costo de compra"
          value={formatMoney(totales.costo, 'BOB')}
          hint="lo que se pagó por todos"
          onClick={() => undefined}
        />
        <Kpi
          label="Valor en libros"
          value={formatMoney(totales.libros, 'BOB')}
          tone="good"
          hint="costo menos lo ya depreciado"
          onClick={() => undefined}
        />
        <Kpi
          label="Depreciación mensual"
          value={formatMoney(totales.mensual, 'BOB')}
          hint="lo que se gasta cada mes (5811)"
          onClick={() => undefined}
        />
      </div>

      <section className="rounded-xl border border-stone-200 bg-white">
        {rows.length === 0 ? (
          <div className="px-4 py-8">
            <EmptyState
              title="Todavía no hay activos registrados"
              hint="Cargá la camioneta, la maquinaria o las computadoras y la depreciación sale sola."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50 text-left">
                  <th className="px-4 py-2 text-xs font-semibold text-stone-500">Activo</th>
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">Categoría</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Costo
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Mensual
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Depreciado
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    En libros
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Le quedan
                  </th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className={`border-b border-stone-100 last:border-0 ${
                      r.estado !== 'activo' ? 'opacity-55' : ''
                    }`}
                  >
                    <td className="px-4 py-2">
                      <p className="font-medium text-stone-900">
                        <span className="font-mono text-xs text-brand">{r.codigo}</span> ·{' '}
                        {r.nombre}
                      </p>
                      <p className="text-xs text-stone-400">
                        {dateLabel(r.fecha_alta)}
                        {r.identificacion ? ` · ${r.identificacion}` : ''}
                        {r.estado !== 'activo' ? ` · ${r.estado.replace('_', ' ')}` : ''}
                      </p>
                      {r.titular === 'tercero' ? (
                        <Badge className="mt-0.5 bg-amber-100 text-amber-800">
                          a nombre de {r.titular_nombre}
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
                        <button
                          type="button"
                          className="text-xs text-stone-400 hover:text-red-600"
                          onClick={async () => {
                            const motivo = window.prompt(
                              `Dar de baja ${r.codigo} · ${r.nombre}. ¿Por qué? (si se vendió, después cargá el valor de venta desde contabilidad)`,
                            );
                            if (!motivo?.trim()) return;
                            const { error } = await supabase.rpc('admin_dar_de_baja_activo', {
                              p_id: r.id,
                              p_fecha: new Date().toISOString().slice(0, 10),
                              p_motivo: motivo.trim(),
                              p_valor_venta: null,
                            });
                            if (error) {
                              push(adminErrorCopy(error.message), 'error');
                              return;
                            }
                            push('Activo dado de baja. Deja de depreciar desde hoy.', 'success');
                            void cargar();
                          }}
                        >
                          Dar de baja
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-stone-100 px-4 py-2.5 text-xs text-stone-400">
          Línea recta: (costo − residual) ÷ meses de vida útil. Las vidas útiles de cada
          categoría vienen de la práctica boliviana (vehículos 5 años, computación 4, maquinaria
          8, muebles 10, edificaciones 40) y son editables — confirmalas con el contador antes de
          cerrar gestión. «Contabilizar depreciación del mes» asienta 5811 contra 1290, un
          renglón por activo.
        </p>
      </section>

      {edit ? (
        <Dialog open onClose={() => setEdit(null)} wide title="Nuevo activo fijo">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-stone-500">Código</label>
              <input
                value={(edit.codigo as string) ?? ''}
                onChange={(e) => setEdit({ ...edit, codigo: e.target.value })}
                placeholder="VEH-001"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">Nombre</label>
              <input
                value={(edit.nombre as string) ?? ''}
                onChange={(e) => setEdit({ ...edit, nombre: e.target.value })}
                placeholder="Toyota Hilux 2024"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">Categoría</label>
              <select
                value={(edit.categoria_id as string) ?? ''}
                onChange={(e) => setEdit({ ...edit, categoria_id: e.target.value })}
                className={inputClass}
              >
                <option value="">— elegir —</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre} · {c.vida_util_meses} meses
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">
                Identificación (placa, serie)
              </label>
              <input
                value={(edit.identificacion as string) ?? ''}
                onChange={(e) => setEdit({ ...edit, identificacion: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">Costo (Bs)</label>
              <input
                type="number"
                min={0}
                value={(edit.costo as number) ?? ''}
                onChange={(e) => setEdit({ ...edit, costo: Number(e.target.value) })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">Valor residual (Bs)</label>
              <input
                type="number"
                min={0}
                value={(edit.valor_residual as number) ?? 0}
                onChange={(e) => setEdit({ ...edit, valor_residual: Number(e.target.value) })}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-stone-400">
                Lo que valdrá al final de su vida útil. Cero si se gasta entero.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">Fecha de compra</label>
              <input
                type="date"
                value={(edit.fecha_compra as string) ?? ''}
                onChange={(e) => setEdit({ ...edit, fecha_compra: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">
                Vida útil (meses — vacío usa la de la categoría)
              </label>
              <input
                type="number"
                min={1}
                value={(edit.vida_util_meses as number) ?? ''}
                onChange={(e) =>
                  setEdit({
                    ...edit,
                    vida_util_meses: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
                className={inputClass}
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={btnSecondary} onClick={() => setEdit(null)}>
              Volver
            </button>
            <button
              type="button"
              className={btnPrimary}
              onClick={async () => {
                const { error } = await supabase.rpc('admin_guardar_activo', {
                  p_id: null,
                  p_project_id: projectId,
                  p_categoria_id: edit.categoria_id || null,
                  p_codigo: edit.codigo,
                  p_nombre: edit.nombre,
                  p_descripcion: null,
                  p_identificacion: edit.identificacion || null,
                  p_fecha_compra: edit.fecha_compra,
                  p_fecha_alta: edit.fecha_compra,
                  p_costo: Number(edit.costo) || 0,
                  p_valor_residual: Number(edit.valor_residual) || 0,
                  p_vida_util_meses: edit.vida_util_meses ?? null,
                  p_centro_costo_id: null,
                  p_proveedor_contact_id: null,
                  p_expense_id: null,
                  p_titular: 'empresa',
                  p_titular_nombre: null,
                  p_nota: null,
                });
                if (error) {
                  push(adminErrorCopy(error.message), 'error');
                  return;
                }
                push('Activo registrado. Ya está depreciando.', 'success');
                setEdit(null);
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
