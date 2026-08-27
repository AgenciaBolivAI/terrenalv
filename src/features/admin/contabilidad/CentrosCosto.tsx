'use client';

// Centros de costo: en qué se va la plata, más fino que la urbanización.
//
// «Obra» como categoría no contesta cuánto costó el agua potable de la etapa
// 2. El centro de costos sí. Cada egreso y cada comprobante puede cargar a
// uno, y acá se ve el acumulado — con el número clickeable, porque una cifra
// sin forma de llegar a lo que cuenta es un callejón sin salida.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/format';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';
import { Badge, EmptyState, Spinner, btnPrimary, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { Dialog } from '@/features/admin/ui/dialog';
import { useToast } from '@/features/admin/ui/toast';
import { dateLabel } from './types';

interface Centro {
  id: string;
  project_id: string | null;
  proyecto: string | null;
  codigo: string;
  nombre: string;
  is_active: boolean;
  cargado: number;
  acreditado: number;
  neto: number;
  movimientos: number;
  ultimo: string | null;
}

export default function CentrosCosto({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const [rows, setRows] = useState<Centro[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<{
    id: string | null;
    codigo: string;
    nombre: string;
    deLaEmpresa: boolean;
    activo: boolean;
  } | null>(null);

  const cargar = useCallback(async () => {
    const { data } = await supabase
      .from('v_centros_costo')
      .select('*')
      .or(`project_id.eq.${projectId},project_id.is.null`)
      .order('codigo');
    setRows((data ?? []) as unknown as Centro[]);
    setLoading(false);
  }, [supabase, projectId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function guardar() {
    if (!edit) return;
    if (!edit.codigo.trim() || !edit.nombre.trim()) {
      push('Hacen falta el código y el nombre.', 'error');
      return;
    }
    const { error } = await supabase.rpc('admin_guardar_centro_costo', {
      p_id: edit.id,
      p_project_id: edit.deLaEmpresa ? null : projectId,
      p_codigo: edit.codigo.trim(),
      p_nombre: edit.nombre.trim(),
      p_activo: edit.activo,
    });
    if (error) {
      push(adminErrorCopy(error.message), 'error');
      return;
    }
    push('Centro de costos guardado.', 'success');
    setEdit(null);
    void cargar();
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 px-4 py-3">
        <div>
          <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
            Centros de costo
          </h2>
          <p className="mt-0.5 text-xs text-stone-500">
            En qué se va la plata dentro de {projectName}. Los que no tienen urbanización son de
            toda la empresa (oficina, administración).
          </p>
        </div>
        <button
          type="button"
          className={`${btnPrimary} ml-auto`}
          onClick={() =>
            setEdit({ id: null, codigo: '', nombre: '', deLaEmpresa: false, activo: true })
          }
        >
          Nuevo centro
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-8">
          <EmptyState
            title="Todavía no hay centros de costo"
            hint="Creá uno (ej. ETAPA2-AGUA · Etapa 2, agua potable) y cargale los egresos."
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50 text-left">
                <th className="px-4 py-2 text-xs font-semibold text-stone-500">Código</th>
                <th className="px-3 py-2 text-xs font-semibold text-stone-500">Nombre</th>
                <th className="px-3 py-2 text-xs font-semibold text-stone-500">Alcance</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                  Cargado
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                  Movimientos
                </th>
                <th className="px-3 py-2 text-xs font-semibold text-stone-500">Último</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-stone-100 last:border-0">
                  <td className="px-4 py-2 font-mono text-xs font-semibold text-stone-700">
                    {c.codigo}
                    {!c.is_active ? (
                      <Badge className="ml-2 bg-stone-200 text-stone-600">inactivo</Badge>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-stone-800">{c.nombre}</td>
                  <td className="px-3 py-2 text-xs text-stone-500">
                    {c.project_id ? (c.proyecto ?? 'esta urbanización') : 'toda la empresa'}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {Number(c.movimientos) > 0 ? (
                      <Link
                        href={`/admin/contabilidad?centro=${c.id}`}
                        className="text-brand hover:underline"
                        title="Ver los movimientos de este centro"
                      >
                        {formatMoney(Number(c.cargado), 'BOB')}
                      </Link>
                    ) : (
                      <span className="text-stone-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-stone-600">
                    {c.movimientos}
                  </td>
                  <td className="px-3 py-2 text-xs text-stone-400">
                    {c.ultimo ? dateLabel(c.ultimo) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      className="text-xs font-medium text-stone-600 hover:text-brand"
                      onClick={() =>
                        setEdit({
                          id: c.id,
                          codigo: c.codigo,
                          nombre: c.nombre,
                          deLaEmpresa: c.project_id === null,
                          activo: c.is_active,
                        })
                      }
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="ml-3 text-xs text-stone-400 hover:text-red-600"
                      onClick={async () => {
                        const { data, error } = await supabase.rpc('admin_borrar_centro_costo', {
                          p_id: c.id,
                        });
                        if (error) {
                          push(adminErrorCopy(error.message), 'error');
                          return;
                        }
                        const d = data as { accion?: string; usos?: number } | null;
                        push(
                          d?.accion === 'desactivado'
                            ? `Tiene ${d.usos} movimiento(s) cargados: se desactivó en vez de borrarse, para no romper el costo histórico.`
                            : 'Centro de costos borrado.',
                          'success',
                        );
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
      )}

      {edit ? (
        <Dialog
          open
          onClose={() => setEdit(null)}
          title={edit.id ? 'Editar centro de costos' : 'Nuevo centro de costos'}
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-stone-500">Código</label>
                <input
                  value={edit.codigo}
                  onChange={(e) => setEdit({ ...edit, codigo: e.target.value })}
                  placeholder="ETAPA2-AGUA"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-stone-500">Nombre</label>
                <input
                  value={edit.nombre}
                  onChange={(e) => setEdit({ ...edit, nombre: e.target.value })}
                  placeholder="Etapa 2 — agua potable"
                  className={inputClass}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-stone-700">
              <input
                type="checkbox"
                checked={edit.deLaEmpresa}
                onChange={(e) => setEdit({ ...edit, deLaEmpresa: e.target.checked })}
              />
              Es de toda la empresa, no de {projectName}
            </label>
            <label className="flex items-center gap-2 text-sm text-stone-700">
              <input
                type="checkbox"
                checked={edit.activo}
                onChange={(e) => setEdit({ ...edit, activo: e.target.checked })}
              />
              Activo (aparece al cargar un egreso)
            </label>
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
    </section>
  );
}
