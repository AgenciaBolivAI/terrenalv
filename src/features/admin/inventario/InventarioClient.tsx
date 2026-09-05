'use client';

// INVENTARIO DE TERRENOS — cuánto costó lo que se vende, y si los precios
// lo cubren.
//
// Se compra un terreno madre, se lotea, y la pregunta que manda es una sola:
// ¿la suma de los precios de los lotes supera el costo total (compra + obras
// capitalizadas)? Si no, se está vendiendo a pérdida y hay que enterarse
// ANTES, no al cerrar la gestión. Esa alarma es la fila roja.

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
import { hoyBolivia } from '@/features/admin/lib/lapaz';

interface Resumen {
  project_id: string;
  proyecto: string;
  parcelas: number;
  superficie_comprada_m2: number;
  costo_compra: number;
  obras_capitalizadas: number;
  costo_total: number;
  lotes: number;
  m2_vendibles: number;
  suma_precios_lista: number;
  costo_m2: number;
  costo_m2_presupuestado: number | null;
  precio_m2_promedio: number;
  margen_potencial: number;
  margen_pct: number | null;
  no_cubre_el_costo: boolean;
  lotes_vendidos: number;
  m2_vendidos: number;
  costo_de_lo_vendido: number;
  inventario_en_libros: number;
}

interface Parcela {
  id: string;
  project_id: string;
  codigo: string;
  nombre: string;
  superficie_m2: number;
  costo_compra: number;
  fecha_compra: string;
  vendedor_nombre: string | null;
  documento: string | null;
  costo_m2_presupuestado: number | null;
  titular: string;
  titular_nombre: string | null;
  nota: string | null;
}

export default function InventarioClient() {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const { projectId } = useAdmin();

  const [filas, setFilas] = useState<Resumen[]>([]);
  const [parcelas, setParcelas] = useState<Parcela[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<Partial<Parcela> | null>(null);

  const cargar = useCallback(async () => {
    const [r, p] = await Promise.all([
      supabase.from('v_inventario_terrenos').select('*').order('proyecto'),
      supabase.from('land_parcels').select('*').order('fecha_compra'),
    ]);
    setFilas((r.data ?? []) as unknown as Resumen[]);
    setParcelas((p.data ?? []) as unknown as Parcela[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const totales = useMemo(
    () => ({
      costo: filas.reduce((s, f) => s + Number(f.costo_total), 0),
      precios: filas.reduce((s, f) => s + Number(f.suma_precios_lista), 0),
      enLibros: filas.reduce((s, f) => s + Number(f.inventario_en_libros), 0),
      alarmas: filas.filter((f) => f.no_cubre_el_costo && Number(f.costo_total) > 0).length,
    }),
    [filas],
  );

  async function guardar() {
    if (!edit) return;
    const { error } = await supabase.rpc('admin_guardar_terreno', {
      p_id: edit.id ?? null,
      p_project_id: edit.project_id ?? projectId,
      p_codigo: edit.codigo,
      p_nombre: edit.nombre,
      p_superficie_m2: Number(edit.superficie_m2) || 0,
      p_costo_compra: Number(edit.costo_compra) || 0,
      p_fecha_compra: edit.fecha_compra,
      p_vendedor_nombre: edit.vendedor_nombre || null,
      p_documento: edit.documento || null,
      p_costo_m2_presupuestado:
        edit.costo_m2_presupuestado == null || edit.costo_m2_presupuestado === ('' as unknown)
          ? null
          : Number(edit.costo_m2_presupuestado),
      p_titular: edit.titular ?? 'empresa',
      p_titular_nombre: edit.titular === 'tercero' ? edit.titular_nombre : null,
      p_nota: edit.nota || null,
    });
    if (error) {
      push(adminErrorCopy(error.message), 'error');
      return;
    }
    push('Terreno guardado. El costo por m² se recalculó solo.', 'success');
    setEdit(null);
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
        <h1 className="text-lg font-bold text-stone-900">Inventario de terrenos</h1>
        <p className="text-xs text-stone-500">
          Cuánto costó lo que se vende, y si los precios lo cubren.
        </p>
        <button
          type="button"
          className={`${btnPrimary} ml-auto`}
          onClick={() =>
            setEdit({
              project_id: projectId ?? undefined,
              fecha_compra: hoyBolivia(),
              titular: 'empresa',
            })
          }
        >
          Registrar compra de terreno
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Costo total"
          value={formatMoney(totales.costo, 'BOB')}
          hint="compra + obras capitalizadas"
          onClick={() => undefined}
        />
        <Kpi
          label="Precios de lista"
          value={formatMoney(totales.precios, 'BOB')}
          tone="good"
          hint="suma de todos los lotes"
          onClick={() => undefined}
        />
        <Kpi
          label="Inventario en libros"
          value={formatMoney(totales.enLibros, 'BOB')}
          hint="cuenta 1151 — lo aún no vendido"
          onClick={() => undefined}
        />
        <Kpi
          label="Urbanizaciones a pérdida"
          value={String(totales.alarmas)}
          tone={totales.alarmas > 0 ? 'bad' : 'normal'}
          hint="precios que no cubren el costo"
          onClick={() => undefined}
        />
      </div>

      <section className="rounded-xl border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-4 py-3">
          <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
            Por urbanización
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50 text-left">
                <th className="px-4 py-2 text-xs font-semibold text-stone-500">Urbanización</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                  Costo total
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                  Costo/m²
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                  Precio/m²
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                  Precios de lista
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                  Margen potencial
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">%</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr
                  key={f.project_id}
                  className={`border-b border-stone-100 last:border-0 ${
                    f.no_cubre_el_costo && Number(f.costo_total) > 0 ? 'bg-red-50' : ''
                  }`}
                >
                  <td className="px-4 py-2">
                    <p className="font-medium text-stone-900">{f.proyecto}</p>
                    <p className="text-xs text-stone-400">
                      {f.lotes} lotes · {Number(f.m2_vendibles).toLocaleString('es-BO')} m²
                      {Number(f.costo_total) === 0 ? ' · sin costo cargado' : ''}
                      {f.costo_m2_presupuestado
                        ? ` · presupuestado ${Number(f.costo_m2_presupuestado)} Bs/m²`
                        : ''}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-stone-600">
                    {formatMoney(Number(f.costo_total), 'BOB')}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-stone-600">
                    {Number(f.costo_m2) > 0 ? `Bs ${Number(f.costo_m2).toFixed(2)}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-stone-600">
                    {Number(f.precio_m2_promedio) > 0
                      ? `Bs ${Number(f.precio_m2_promedio).toFixed(2)}`
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-stone-600">
                    {formatMoney(Number(f.suma_precios_lista), 'BOB')}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-semibold tabular-nums ${
                      Number(f.margen_potencial) >= 0 || Number(f.costo_total) === 0
                        ? 'text-brand'
                        : 'text-red-600'
                    }`}
                  >
                    {Number(f.costo_total) > 0
                      ? formatMoney(Number(f.margen_potencial), 'BOB')
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-stone-500">
                    {f.margen_pct == null || Number(f.costo_total) === 0
                      ? '—'
                      : `${Number(f.margen_pct).toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-stone-100 px-4 py-2.5 text-xs text-stone-400">
          Una fila roja vende a pérdida: los precios de lista no cubren lo que costó el terreno
          más las obras. El costo por m² sale de dividir el costo total entre los m² vendibles —
          o del presupuesto, si se cargó uno. Las obras capitalizan marcando su centro de costos
          en Contabilidad gerencial → Gestión.
        </p>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-4 py-3">
          <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
            Terrenos comprados
          </h2>
        </div>
        {parcelas.length === 0 ? (
          <div className="px-4 py-8">
            <EmptyState
              title="Todavía no hay compras de terreno registradas"
              hint="Registrá la compra del terreno madre y el costo por m² de cada lote sale solo."
            />
          </div>
        ) : (
          <ul className="divide-y divide-stone-100">
            {parcelas.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-stone-900">
                    <span className="font-mono text-xs text-brand">{p.codigo}</span> · {p.nombre}
                  </p>
                  <p className="text-xs text-stone-400">
                    {dateLabel(p.fecha_compra)} ·{' '}
                    {Number(p.superficie_m2).toLocaleString('es-BO')} m²
                    {p.vendedor_nombre ? ` · comprado a ${p.vendedor_nombre}` : ''}
                    {p.documento ? ` · ${p.documento}` : ''}
                  </p>
                  {p.titular === 'tercero' ? (
                    <Badge className="mt-1 bg-amber-100 text-amber-800">
                      a nombre de {p.titular_nombre}
                    </Badge>
                  ) : null}
                </div>
                <span className="font-semibold tabular-nums text-stone-900">
                  {formatMoney(Number(p.costo_compra), 'BOB')}
                </span>
                <button
                  type="button"
                  className="text-xs font-medium text-stone-600 hover:text-brand"
                  onClick={() => setEdit(p)}
                >
                  Editar
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {edit ? (
        <Dialog
          open
          onClose={() => setEdit(null)}
          wide
          title={edit.id ? 'Editar terreno' : 'Registrar compra de terreno'}
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-stone-500">Código</label>
              <input
                value={edit.codigo ?? ''}
                onChange={(e) => setEdit({ ...edit, codigo: e.target.value })}
                placeholder="PDS-MADRE"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">Nombre</label>
              <input
                value={edit.nombre ?? ''}
                onChange={(e) => setEdit({ ...edit, nombre: e.target.value })}
                placeholder="Fundo Prados del Sur"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">Superficie (m²)</label>
              <input
                type="number"
                min={0}
                value={edit.superficie_m2 ?? ''}
                onChange={(e) => setEdit({ ...edit, superficie_m2: Number(e.target.value) })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">Costo de compra (Bs)</label>
              <input
                type="number"
                min={0}
                value={edit.costo_compra ?? ''}
                onChange={(e) => setEdit({ ...edit, costo_compra: Number(e.target.value) })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">Fecha de compra</label>
              <input
                type="date"
                value={edit.fecha_compra ?? ''}
                onChange={(e) => setEdit({ ...edit, fecha_compra: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">Comprado a</label>
              <input
                value={edit.vendedor_nombre ?? ''}
                onChange={(e) => setEdit({ ...edit, vendedor_nombre: e.target.value })}
                placeholder="Nombre del vendedor"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">Documento / escritura</label>
              <input
                value={edit.documento ?? ''}
                onChange={(e) => setEdit({ ...edit, documento: e.target.value })}
                placeholder="Testimonio 123/2025"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">
                Costo presupuestado por m² (opcional)
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={edit.costo_m2_presupuestado ?? ''}
                onChange={(e) =>
                  setEdit({
                    ...edit,
                    costo_m2_presupuestado:
                      e.target.value === '' ? null : Number(e.target.value),
                  })
                }
                className={inputClass}
              />
              <p className="mt-1 text-xs text-stone-400">
                Si se carga, el costo de cada venta usa este número y el margen no salta según
                cuándo se pagó cada obra.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">A nombre de</label>
              <select
                value={edit.titular ?? 'empresa'}
                onChange={(e) => setEdit({ ...edit, titular: e.target.value })}
                className={inputClass}
              >
                <option value="empresa">La empresa</option>
                <option value="tercero">Un tercero</option>
              </select>
            </div>
            {edit.titular === 'tercero' ? (
              <div>
                <label className="mb-1 block text-xs text-stone-500">¿De quién?</label>
                <input
                  value={edit.titular_nombre ?? ''}
                  onChange={(e) => setEdit({ ...edit, titular_nombre: e.target.value })}
                  className={inputClass}
                />
              </div>
            ) : null}
          </div>
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
    </div>
  );
}
