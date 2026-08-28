'use client';

// FONDOS POR RENDIR.
//
// Se le da plata a alguien para que compre, y esa persona después rinde con
// facturas. Mientras no rinde, esa plata NO es un gasto: es algo que esa
// persona le debe a la empresa. Por eso vive en 1.02.04.030 y no en una cuenta
// de gasto, y por eso el saldo se lleva por persona.
//
// El ciclo entero:
//   entregar   → sale de la caja y queda a nombre de la persona
//   rendir     → se carga como egreso con forma «Fondos por rendir»; el saldo baja
//   devolver   → lo que no gastó vuelve a la caja
//
// Vive en «Bancos y caja» porque una entrega es plata saliendo de un banco,
// igual que una transferencia.

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/format';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';
import { EmptyState, Spinner, btnPrimary, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { Dialog } from '@/features/admin/ui/dialog';
import { useToast } from '@/features/admin/ui/toast';
import { CuentaSelect, useTesoreria } from './Tesoreria';
import { dateLabel, todayIso } from './types';

interface FondoFila {
  empleado_id: string;
  codigo: string;
  nombre_completo: string;
  estado: string;
  entregado: number;
  devuelto: number;
  rendido: number;
  saldo: number;
  ultima_entrega: string | null;
}

interface Empleado {
  id: string;
  nombre_completo: string;
  codigo: string;
}

interface Rendicion {
  id: string;
  numero: string | null;
  incurred_on: string;
  description: string;
  amount_bob: number;
}

export default function FondosPorRendir() {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const { cuentas } = useTesoreria();

  const [rows, setRows] = useState<FondoFila[] | null>(null);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [rendiciones, setRendiciones] = useState<Record<string, Rendicion[]>>({});
  const [dialogo, setDialogo] = useState<'entrega' | 'devolucion' | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    const [f, e] = await Promise.all([
      supabase.from('v_fondos_por_rendir').select('*').order('nombre_completo'),
      supabase
        .from('hr_empleados')
        .select('id, nombre_completo, codigo')
        .eq('estado', 'activo')
        .order('nombre_completo'),
    ]);
    setRows((f.data ?? []) as unknown as FondoFila[]);
    setEmpleados((e.data ?? []) as Empleado[]);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const abrir = useCallback(
    async (empleadoId: string) => {
      if (abierto === empleadoId) {
        setAbierto(null);
        return;
      }
      setAbierto(empleadoId);
      if (rendiciones[empleadoId]) return;
      const { data } = await supabase
        .from('expenses')
        .select('id, numero, incurred_on, description, amount_bob')
        .eq('forma_pago', 'fondos_por_rendir')
        .eq('fondo_empleado_id', empleadoId)
        .is('deleted_at', null)
        .order('incurred_on', { ascending: false });
      setRendiciones((prev) => ({ ...prev, [empleadoId]: (data ?? []) as Rendicion[] }));
    },
    [abierto, rendiciones, supabase],
  );

  const totalPendiente = (rows ?? []).reduce((s, f) => s + Number(f.saldo), 0);

  return (
    <section className="rounded-xl border border-stone-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 px-4 py-3">
        <div>
          <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
            Fondos por rendir
          </h2>
          <p className="mt-0.5 text-xs text-stone-500">
            Plata entregada a una persona para gastos, que después rinde con facturas.
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <button type="button" className={btnSecondary} onClick={() => setDialogo('devolucion')}>
            Registrar devolución
          </button>
          <button type="button" className={btnPrimary} onClick={() => setDialogo('entrega')}>
            Entregar fondos
          </button>
        </div>
      </div>

      {rows === null ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : !rows.length ? (
        <div className="px-4 py-8">
          <EmptyState
            title="Nadie tiene fondos por rendir"
            hint="«Entregar fondos» le da plata a alguien para gastos que después rinde con facturas."
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-175 text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50 text-left">
                <th className="px-4 py-2 text-xs font-semibold text-stone-500">Persona</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Entregado</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Rendido</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Devuelto</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Le queda</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <Fragment key={f.empleado_id}>
                  <tr
                    onClick={() => void abrir(f.empleado_id)}
                    className={`cursor-pointer border-b border-stone-100 hover:bg-stone-50 ${
                      abierto === f.empleado_id ? 'bg-stone-50' : ''
                    }`}
                  >
                    <td className="px-4 py-2 text-stone-800">
                      {f.nombre_completo}
                      {f.ultima_entrega ? (
                        <span className="block text-[11px] text-stone-500">
                          última entrega: {dateLabel(f.ultima_entrega)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-stone-600">
                      {formatMoney(Number(f.entregado), 'BOB')}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-stone-600">
                      {formatMoney(Number(f.rendido), 'BOB')}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-stone-600">
                      {formatMoney(Number(f.devuelto), 'BOB')}
                    </td>
                    <td className={`px-3 py-2 text-right font-semibold tabular-nums ${
                      Number(f.saldo) > 0 ? 'text-stone-900' : 'text-stone-400'
                    }`}>
                      {formatMoney(Number(f.saldo), 'BOB')}
                    </td>
                  </tr>
                  {abierto === f.empleado_id ? (
                    <tr className="border-b border-stone-100 bg-stone-50/60">
                      <td colSpan={5} className="px-4 py-3">
                        <p className="mb-2 text-xs font-semibold text-stone-600">
                          Lo que rindió
                        </p>
                        {!rendiciones[f.empleado_id] ? (
                          <Spinner />
                        ) : !rendiciones[f.empleado_id].length ? (
                          <p className="text-xs text-stone-500">
                            Todavía no rindió nada. Se rinde cargando un egreso con forma de pago
                            «Fondos por rendir».
                          </p>
                        ) : (
                          <ul className="space-y-1">
                            {rendiciones[f.empleado_id].map((r) => (
                              <li key={r.id} className="flex items-center gap-2 text-xs">
                                <span className="w-20 shrink-0 text-stone-500">
                                  {dateLabel(r.incurred_on)}
                                </span>
                                <Link
                                  href={`/admin/egreso/${r.id}`}
                                  className="font-medium text-brand underline"
                                >
                                  {r.numero ?? 'ver'}
                                </Link>
                                <span className="flex-1 text-stone-700">{r.description}</span>
                                <span className="tabular-nums text-stone-600">
                                  {formatMoney(Number(r.amount_bob), 'BOB')}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-stone-300 bg-stone-50 font-semibold">
                <td className="px-4 py-2 text-xs text-stone-500" colSpan={4}>
                  Sin rendir en total
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatMoney(totalPendiente, 'BOB')}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="border-t border-stone-100 px-4 py-2.5 text-xs text-stone-500">
        Se entrega el fondo → la persona gasta y rinde cada factura como egreso «Fondos por
        rendir» → el saldo baja. Saldo en cero es fondo rendido del todo.
      </p>

      {dialogo ? (
        <MovimientoDialog
          modo={dialogo}
          empleados={empleados}
          saldos={rows ?? []}
          cuentas={cuentas}
          onClose={() => setDialogo(null)}
          onHecho={() => {
            setDialogo(null);
            setRendiciones({});
            void load();
          }}
          push={push}
        />
      ) : null}
    </section>
  );
}

function MovimientoDialog({
  modo,
  empleados,
  saldos,
  cuentas,
  onClose,
  onHecho,
  push,
}: {
  modo: 'entrega' | 'devolucion';
  empleados: Empleado[];
  saldos: FondoFila[];
  cuentas: ReturnType<typeof useTesoreria>['cuentas'];
  onClose: () => void;
  onHecho: () => void;
  push: (m: string, t?: 'success' | 'error') => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [empleadoId, setEmpleadoId] = useState('');
  const [monto, setMonto] = useState('');
  const [cuentaId, setCuentaId] = useState('');
  const [fecha, setFecha] = useState(todayIso);
  const [nota, setNota] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const esEntrega = modo === 'entrega';
  // Para devolver solo tiene sentido quien tenga saldo.
  const lista = esEntrega ? empleados : saldos.filter((s) => Number(s.saldo) > 0);
  const saldo = saldos.find((s) => s.empleado_id === empleadoId);

  async function guardar() {
    setError(null);
    if (!empleadoId) {
      setError('Elegí a la persona.');
      return;
    }
    if (!(Number(monto) > 0)) {
      setError('El monto tiene que ser mayor a cero.');
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.rpc(
      esEntrega ? 'admin_entregar_fondo' : 'admin_devolver_fondo',
      {
        p_empleado_id: empleadoId,
        p_monto: Number(monto),
        p_treasury_account_id: cuentaId || null,
        p_fecha: fecha,
        p_glosa: null,
        p_nota: nota.trim() || null,
      },
    );
    setBusy(false);
    if (err) {
      setError(adminErrorCopy(err.message));
      return;
    }
    push(esEntrega ? 'Fondo entregado.' : 'Devolución registrada.', 'success');
    onHecho();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={esEntrega ? 'Entregar fondos a rendir' : 'Registrar devolución'}
    >
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-stone-500">¿A quién?</label>
          <select
            value={empleadoId}
            onChange={(e) => setEmpleadoId(e.target.value)}
            className={inputClass}
          >
            <option value="">— elegí a la persona —</option>
            {esEntrega
              ? empleados.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre_completo}
                  </option>
                ))
              : (lista as FondoFila[]).map((s) => (
                  <option key={s.empleado_id} value={s.empleado_id}>
                    {s.nombre_completo} · le quedan {formatMoney(Number(s.saldo), 'BOB')}
                  </option>
                ))}
          </select>
          {!lista.length ? (
            <p className="mt-1 text-[11px] text-amber-700">
              {esEntrega
                ? 'No hay personal cargado. Se agrega en Recursos Humanos.'
                : 'Nadie tiene saldo pendiente de rendir.'}
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Monto (Bs)</label>
            <input
              type="number"
              step="0.01"
              min={0}
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              className={inputClass}
            />
            {!esEntrega && saldo ? (
              <p className="mt-1 text-[11px] text-stone-500">
                Tiene {formatMoney(Number(saldo.saldo), 'BOB')} sin rendir.
              </p>
            ) : null}
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">Fecha</label>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputClass} />
          </div>
        </div>

        <CuentaSelect
          cuentas={cuentas}
          value={cuentaId}
          onChange={setCuentaId}
          label={esEntrega ? '¿De qué caja o banco sale?' : '¿A qué caja o banco vuelve?'}
          monto={Number(monto)}
          signo={esEntrega ? -1 : 1}
        />

        <textarea
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          rows={2}
          placeholder="Nota (opcional)"
          className={inputClass}
        />

        <p className="text-[11px] text-stone-500">
          {esEntrega
            ? 'La plata pasa a 1.02.04.030 · Fondos por Rendir a nombre de esa persona. Todavía no es un gasto: se vuelve gasto cuando rinde las facturas.'
            : 'Lo que devuelve vuelve a la caja y baja su saldo de 1.02.04.030.'}
        </p>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Volver
        </button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void guardar()}>
          {busy ? 'Guardando…' : esEntrega ? 'Entregar' : 'Registrar devolución'}
        </button>
      </div>
    </Dialog>
  );
}
