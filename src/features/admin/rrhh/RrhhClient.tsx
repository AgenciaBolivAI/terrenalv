'use client';

// RECURSOS HUMANOS — el personal y la planilla del mes.
//
// Un empleado no es un usuario del panel: la cuadrilla no tiene login. La
// planilla se arma sola con los activos del mes, se le cargan bonos y
// descuentos por persona, y al pagarla la contabilidad sale sola: un egreso
// de sueldos por empleado, con su centro de costos, desde la caja elegida.

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
import { CuentaSelect, useTesoreria } from '@/features/admin/contabilidad/Tesoreria';
import { EmpleadoFile } from './EmpleadoFile';
import type { Empleado } from './tipos';

// La ficha vive en `tipos.ts`: la comparten la lista y el file.

/** Una planilla pasa por tres estados: se arma, se devenga y se paga. */
interface Planilla {
  id: string;
  anio: number;
  mes: number;
  estado: 'borrador' | 'devengada' | 'pagada';
  devengada_el: string | null;
  pagada_at: string | null;
}

interface Item {
  id: string;
  planilla_id: string;
  empleado_id: string;
  salario: number;
  bonos: number;
  descuentos: number;
  neto: number;
  nota: string | null;
}

const MES_LABEL = [
  '',
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export default function RrhhClient() {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const { cuentas } = useTesoreria();

  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [planillas, setPlanillas] = useState<Planilla[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [vista, setVista] = useState<'personal' | 'planillas'>('personal');
  const [edit, setEdit] = useState<Partial<Empleado> | null>(null);
  /** El file completo del dependiente, con sus papeles. */
  const [file, setFile] = useState<Empleado | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [pagando, setPagando] = useState<Planilla | null>(null);
  const [busy, setBusy] = useState(false);
  const [cuentaId, setCuentaId] = useState('');

  const cargar = useCallback(async () => {
    const [e, p, i] = await Promise.all([
      supabase.from('hr_empleados').select('*').order('codigo'),
      supabase.from('hr_planillas').select('*').order('anio', { ascending: false }).order('mes', {
        ascending: false,
      }),
      supabase.from('hr_planilla_items').select('*'),
    ]);
    setEmpleados((e.data ?? []) as unknown as Empleado[]);
    setPlanillas((p.data ?? []) as unknown as Planilla[]);
    setItems((i.data ?? []) as unknown as Item[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const activos = useMemo(() => empleados.filter((e) => e.estado === 'activo'), [empleados]);
  const masaSalarial = useMemo(
    () => activos.reduce((s, e) => s + Number(e.salario_mensual), 0),
    [activos],
  );
  const empleadoDe = useCallback(
    (id: string) => empleados.find((e) => e.id === id),
    [empleados],
  );

  async function armarPlanilla() {
    const hoy = new Date();
    const { data, error } = await supabase.rpc('admin_armar_planilla', {
      p_anio: hoy.getFullYear(),
      p_mes: hoy.getMonth() + 1,
    });
    if (error) {
      push(adminErrorCopy(error.message), 'error');
      return;
    }
    const d = data as { empleados?: number } | null;
    push(`Planilla armada con ${d?.empleados ?? 0} empleado(s). Revisala y devengala.`, 'success');
    setVista('planillas');
    void cargar();
  }

  /**
   * Devengar: el gasto de sueldos entra al libro con fecha del mes trabajado y
   * queda debiéndose al personal. La plata recién sale al pagar.
   */
  async function devengar(p: Planilla) {
    setBusy(true);
    const { data, error } = await supabase.rpc('admin_devengar_planilla', {
      p_planilla_id: p.id,
      p_fecha: null,
    });
    setBusy(false);
    if (error) {
      push(adminErrorCopy(error.message), 'error');
      return;
    }
    const d = data as { empleados?: number; total?: number; fecha?: string } | null;
    push(
      `Planilla devengada: ${formatMoney(Number(d?.total ?? 0), 'BOB')} de sueldos al ${
        d?.fecha ? dateLabel(d.fecha) : 'cierre del mes'
      }. Queda por pagar.`,
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

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-lg font-bold text-stone-900">Recursos Humanos</h1>
        <p className="text-xs text-stone-500">El personal, sus sueldos y la planilla del mes.</p>
        <div className="ml-auto flex gap-2">
          <button type="button" className={btnSecondary} onClick={() => void armarPlanilla()}>
            Armar planilla del mes
          </button>
          <button
            type="button"
            className={btnPrimary}
            onClick={() => setEdit({ fecha_ingreso: new Date().toISOString().slice(0, 10) })}
          >
            Nuevo empleado
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Personal activo"
          value={String(activos.length)}
          hint="empleados sin retirar"
          onClick={() => setVista('personal')}
        />
        <Kpi
          label="Masa salarial"
          value={formatMoney(masaSalarial, 'BOB')}
          hint="sueldos base por mes"
          onClick={() => setVista('personal')}
        />
        <Kpi
          label="Planillas pagadas"
          value={String(planillas.filter((p) => p.estado === 'pagada').length)}
          hint="cada una con sus egresos — ver"
          onClick={() => setVista('planillas')}
        />
        <Kpi
          label="Sin devengar o sin pagar"
          value={String(planillas.filter((p) => p.estado !== 'pagada').length)}
          tone={planillas.some((p) => p.estado !== 'pagada') ? 'bad' : 'normal'}
          hint="armadas, devengadas o pendientes — ver"
          onClick={() => setVista('planillas')}
        />
      </div>

      <div className="flex gap-1 rounded-xl border border-stone-200 bg-white p-1">
        {(
          [
            ['personal', `Personal (${activos.length})`],
            ['planillas', `Planillas (${planillas.length})`],
          ] as ['personal' | 'planillas', string][]
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

      {vista === 'personal' ? (
        <section className="rounded-xl border border-stone-200 bg-white">
          {empleados.length === 0 ? (
            <div className="px-4 py-8">
              <EmptyState
                title="Todavía no hay personal cargado"
                hint="Cargá a cada persona con su cargo y su sueldo, y la planilla del mes se arma sola."
              />
            </div>
          ) : (
            <ul className="divide-y divide-stone-100">
              {empleados.map((e) => (
                <li
                  key={e.id}
                  className={`flex flex-wrap items-center gap-3 px-4 py-3 text-sm ${
                    e.estado !== 'activo' ? 'opacity-55' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-stone-900">
                      <span className="font-mono text-xs text-brand">{e.codigo}</span> ·{' '}
                      {e.nombre_completo}
                      {e.estado !== 'activo' ? (
                        <Badge className="ml-2 bg-stone-200 text-stone-600">retirado</Badge>
                      ) : null}
                    </p>
                    <p className="text-xs text-stone-400">
                      {e.cargo}
                      {e.area ? ` · ${e.area}` : ''} · desde {dateLabel(e.fecha_ingreso)}
                      {e.ci ? ` · CI ${e.ci}` : ''}
                    </p>
                  </div>
                  <span className="font-semibold tabular-nums text-stone-900">
                    {formatMoney(Number(e.salario_mensual), 'BOB')}
                  </span>
                  <button
                    type="button"
                    className="text-xs font-medium text-stone-600 hover:text-brand"
                    onClick={() => setFile(e)}
                  >
                    File
                  </button>
                  <button
                    type="button"
                    className="text-xs font-medium text-stone-600 hover:text-brand"
                    onClick={() => setEdit(e)}
                  >
                    Editar
                  </button>
                  {e.estado === 'activo' ? (
                    <button
                      type="button"
                      className="text-xs text-stone-400 hover:text-red-600"
                      onClick={async () => {
                        const motivo = window.prompt(
                          `Retirar a ${e.nombre_completo}. ¿Motivo? (renuncia, despido, fin de contrato)`,
                        );
                        if (!motivo?.trim()) return;
                        const { error } = await supabase.rpc('admin_retirar_empleado', {
                          p_id: e.id,
                          p_fecha: new Date().toISOString().slice(0, 10),
                          p_nota: motivo.trim(),
                        });
                        if (error) {
                          push(adminErrorCopy(error.message), 'error');
                          return;
                        }
                        push('Retirado. No entra en las próximas planillas.', 'success');
                        void cargar();
                      }}
                    >
                      Retirar
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {vista === 'planillas' ? (
        <section className="space-y-3">
          {planillas.length === 0 ? (
            <div className="rounded-xl border border-stone-200 bg-white px-4 py-8">
              <EmptyState
                title="Todavía no hay planillas"
                hint="«Armar planilla del mes» crea un renglón por empleado activo con su sueldo."
              />
            </div>
          ) : (
            planillas.map((p) => {
              const suyos = items.filter((i) => i.planilla_id === p.id);
              const total = suyos.reduce((s, i) => s + Number(i.neto), 0);
              const abiertaEsta = abierta === p.id;
              return (
                <div key={p.id} className="rounded-xl border border-stone-200 bg-white">
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-stone-50"
                    onClick={() => setAbierta(abiertaEsta ? null : p.id)}
                  >
                    <p className="font-medium text-stone-900">
                      {MES_LABEL[p.mes]} {p.anio}
                    </p>
                    <Badge
                      className={
                        p.estado === 'pagada'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-amber-100 text-amber-800'
                      }
                    >
                      {p.estado}
                    </Badge>
                    <span className="text-xs text-stone-400">{suyos.length} empleado(s)</span>
                    <span className="ml-auto font-semibold tabular-nums text-stone-900">
                      {formatMoney(total, 'BOB')}
                    </span>
                    <span className="text-xs text-stone-300">{abiertaEsta ? '▲' : '▼'}</span>
                  </button>

                  {abiertaEsta ? (
                    <div className="border-t border-stone-100 px-4 py-3">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-stone-200 text-left">
                            <th className="py-1.5 text-xs font-semibold text-stone-500">
                              Empleado
                            </th>
                            <th className="py-1.5 text-right text-xs font-semibold text-stone-500">
                              Sueldo
                            </th>
                            <th className="py-1.5 text-right text-xs font-semibold text-stone-500">
                              Bonos
                            </th>
                            <th className="py-1.5 text-right text-xs font-semibold text-stone-500">
                              Descuentos
                            </th>
                            <th className="py-1.5 text-right text-xs font-semibold text-stone-500">
                              Neto
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {suyos.map((i) => {
                            const emp = empleadoDe(i.empleado_id);
                            return (
                              <tr key={i.id} className="border-b border-stone-100 last:border-0">
                                <td className="py-1.5 text-stone-800">
                                  {emp?.nombre_completo ?? '—'}
                                  {i.nota ? (
                                    <span className="ml-2 text-xs text-stone-400">{i.nota}</span>
                                  ) : null}
                                </td>
                                {p.estado === 'borrador' ? (
                                  <>
                                    {(['salario', 'bonos', 'descuentos'] as const).map((campo) => (
                                      <td key={campo} className="py-1 text-right">
                                        <input
                                          type="number"
                                          min={0}
                                          defaultValue={Number(i[campo])}
                                          onBlur={async (ev) => {
                                            const v = Number(ev.target.value) || 0;
                                            if (v === Number(i[campo])) return;
                                            const { error } = await supabase.rpc(
                                              'admin_editar_item_planilla',
                                              {
                                                p_item_id: i.id,
                                                p_salario: campo === 'salario' ? v : null,
                                                p_bonos: campo === 'bonos' ? v : null,
                                                p_descuentos: campo === 'descuentos' ? v : null,
                                                p_nota: i.nota,
                                              },
                                            );
                                            if (error) {
                                              push(adminErrorCopy(error.message), 'error');
                                              return;
                                            }
                                            void cargar();
                                          }}
                                          className="w-24 rounded-lg border border-stone-200 px-2 py-1 text-right text-sm"
                                        />
                                      </td>
                                    ))}
                                  </>
                                ) : (
                                  <>
                                    <td className="py-1.5 text-right tabular-nums text-stone-600">
                                      {formatMoney(Number(i.salario), 'BOB')}
                                    </td>
                                    <td className="py-1.5 text-right tabular-nums text-stone-600">
                                      {Number(i.bonos) ? formatMoney(Number(i.bonos), 'BOB') : '—'}
                                    </td>
                                    <td className="py-1.5 text-right tabular-nums text-stone-600">
                                      {Number(i.descuentos)
                                        ? formatMoney(Number(i.descuentos), 'BOB')
                                        : '—'}
                                    </td>
                                  </>
                                )}
                                <td className="py-1.5 text-right font-semibold tabular-nums">
                                  {formatMoney(Number(i.neto), 'BOB')}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>

                      {/* El sueldo es del mes trabajado: primero se devenga
                          —el gasto entra al libro contra SUELDOS POR PAGAR— y
                          después se paga, que es cuando sale la plata. */}
                      {p.estado === 'borrador' ? (
                        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                          <p className="mr-auto text-xs text-stone-500">
                            Al devengarla, el gasto entra al libro con fecha del último día de{' '}
                            {MES_LABEL[p.mes]} y queda debiéndose al personal (2.01.07.010).
                          </p>
                          <button
                            type="button"
                            className={btnPrimary}
                            disabled={busy}
                            onClick={() => void devengar(p)}
                          >
                            Devengar planilla — {formatMoney(total, 'BOB')}
                          </button>
                        </div>
                      ) : p.estado === 'devengada' ? (
                        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                          <p className="mr-auto text-xs text-stone-500">
                            Devengada{p.devengada_el ? ` al ${dateLabel(p.devengada_el)}` : ''}: el
                            gasto ya está en el libro y se le debe al personal. Falta pagarla.
                          </p>
                          <button
                            type="button"
                            className={btnPrimary}
                            onClick={() => {
                              setPagando(p);
                              setCuentaId('');
                            }}
                          >
                            Pagar planilla — {formatMoney(total, 'BOB')}
                          </button>
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-stone-400">
                          Pagada{p.pagada_at ? ` el ${dateLabel(p.pagada_at)}` : ''}. Cada
                          empleado tiene su egreso en Contabilidad gerencial → Egresos, con su
                          comprobante.
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </section>
      ) : null}

      {/* ---- alta / edición de empleado ---- */}
      {edit ? (
        <Dialog
          open
          onClose={() => setEdit(null)}
          title={edit.id ? 'Editar empleado' : 'Nuevo empleado'}
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-stone-500">Código</label>
              <input
                value={edit.codigo ?? ''}
                onChange={(e) => setEdit({ ...edit, codigo: e.target.value })}
                placeholder="EMP-001"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">Nombre completo</label>
              <input
                value={edit.nombre_completo ?? ''}
                onChange={(e) => setEdit({ ...edit, nombre_completo: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">CI</label>
              <input
                value={edit.ci ?? ''}
                onChange={(e) => setEdit({ ...edit, ci: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">Teléfono</label>
              <input
                value={edit.telefono ?? ''}
                onChange={(e) => setEdit({ ...edit, telefono: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">Cargo</label>
              <input
                value={edit.cargo ?? ''}
                onChange={(e) => setEdit({ ...edit, cargo: e.target.value })}
                placeholder="Sereno, secretaria, chofer…"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">Área</label>
              <input
                value={edit.area ?? ''}
                onChange={(e) => setEdit({ ...edit, area: e.target.value })}
                placeholder="Obra, administración, ventas…"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">Fecha de ingreso</label>
              <input
                type="date"
                value={edit.fecha_ingreso ?? ''}
                onChange={(e) => setEdit({ ...edit, fecha_ingreso: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">Sueldo mensual (Bs)</label>
              <input
                type="number"
                min={0}
                value={edit.salario_mensual ?? ''}
                onChange={(e) => setEdit({ ...edit, salario_mensual: Number(e.target.value) })}
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
                const { error } = await supabase.rpc('admin_guardar_empleado', {
                  p_id: edit.id ?? null,
                  p_codigo: edit.codigo,
                  p_nombre: edit.nombre_completo,
                  p_ci: edit.ci || null,
                  p_telefono: edit.telefono || null,
                  p_correo: null,
                  p_cargo: edit.cargo,
                  p_area: edit.area || null,
                  p_project_id: null,
                  p_centro_costo_id: null,
                  p_profile_id: null,
                  p_fecha_ingreso: edit.fecha_ingreso,
                  p_salario: Number(edit.salario_mensual) || 0,
                  p_nota: null,
                });
                if (error) {
                  push(adminErrorCopy(error.message), 'error');
                  return;
                }
                push('Empleado guardado.', 'success');
                setEdit(null);
                void cargar();
              }}
            >
              Guardar
            </button>
          </div>
        </Dialog>
      ) : null}

      {/* ---- pagar planilla ---- */}
      {pagando ? (
        <Dialog
          open
          onClose={() => setPagando(null)}
          title={`Pagar planilla — ${MES_LABEL[pagando.mes]} ${pagando.anio}`}
        >
          <p className="text-sm text-stone-600">
            Genera un egreso de sueldos por cada empleado —con su comprobante— desde la caja que
            elijas. Una planilla pagada no se puede tocar: la plata ya salió.
          </p>
          <div className="mt-3">
            <CuentaSelect
              cuentas={cuentas}
              value={cuentaId}
              onChange={setCuentaId}
              label="¿De qué caja o banco sale?"
              signo={-1}
            />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={btnSecondary} onClick={() => setPagando(null)}>
              Volver
            </button>
            <button
              type="button"
              className={btnPrimary}
              disabled={!cuentaId}
              onClick={async () => {
                const { data, error } = await supabase.rpc('admin_pagar_planilla', {
                  p_planilla_id: pagando.id,
                  p_treasury_account_id: cuentaId,
                  p_fecha: new Date().toISOString().slice(0, 10),
                });
                if (error) {
                  push(adminErrorCopy(error.message), 'error');
                  return;
                }
                const d = data as { empleados?: number; total?: number } | null;
                push(
                  `Planilla pagada: ${d?.empleados ?? 0} empleado(s), ${formatMoney(
                    Number(d?.total ?? 0),
                    'BOB',
                  )}. Los egresos ya están en contabilidad.`,
                  'success',
                );
                setPagando(null);
                void cargar();
              }}
            >
              Pagar
            </button>
          </div>
        </Dialog>
      ) : null}

      {file ? (
        <EmpleadoFile
          empleado={file}
          onClose={() => setFile(null)}
          onSaved={() => {
            setFile(null);
            void cargar();
          }}
        />
      ) : null}
    </div>
  );
}
