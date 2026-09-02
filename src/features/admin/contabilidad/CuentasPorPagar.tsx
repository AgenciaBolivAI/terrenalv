'use client';

// LO QUE LA EMPRESA DEBE.
//
// La otra mitad de «Por cobrar». Acá están las facturas de proveedores que se
// compraron a crédito y los activos fijos que todavía no se pagaron, con su
// antigüedad: no es lo mismo deber algo que vence la semana que viene que algo
// vencido hace tres meses.
//
// Sale de `v_cuentas_por_pagar`, y su total tiene que ser exactamente el saldo
// de 2.01.04.010 en el libro — hay un guardián que lo comprueba en cada
// despliegue. Si esta pantalla y el mayor dijeran cosas distintas, una de las
// dos estaría mintiendo.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/format';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';
import { Badge, EmptyState, Kpi, Spinner, btnPrimary, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { Dialog } from '@/features/admin/ui/dialog';
import { useToast } from '@/features/admin/ui/toast';
import { ExportButtons } from '@/features/admin/export/ExportButtons';
import { num, type Cell } from '@/features/admin/export';
import { CuentaSelect, useTesoreria } from './Tesoreria';
import { dateLabel, todayIso } from './types';

interface Deuda {
  id: string;
  tipo: 'egreso' | 'activo';
  project_id: string;
  proyecto: string;
  proveedor: string | null;
  proveedor_nit: string | null;
  numero: string;
  numero_factura: string | null;
  detalle: string;
  fecha: string;
  vencimiento: string | null;
  /** Lo que FALTA pagar. El importe original está en `importe`. */
  monto: number;
  dias_vencido: number;
  importe: number;
  pagado: number;
}

/** Los tramos con los que un contador mira una deuda. */
type Tramo = 'todo' | 'por_vencer' | 'v30' | 'v60' | 'v90' | 'v90mas';

const TRAMOS: { id: Tramo; label: string }[] = [
  { id: 'todo', label: 'Todas' },
  { id: 'por_vencer', label: 'Por vencer' },
  { id: 'v30', label: '1 a 30 días' },
  { id: 'v60', label: '31 a 60' },
  { id: 'v90', label: '61 a 90' },
  { id: 'v90mas', label: 'Más de 90' },
];

function enTramo(d: Deuda, t: Tramo): boolean {
  const v = Number(d.dias_vencido) || 0;
  switch (t) {
    case 'todo': return true;
    case 'por_vencer': return v === 0;
    case 'v30': return v >= 1 && v <= 30;
    case 'v60': return v >= 31 && v <= 60;
    case 'v90': return v >= 61 && v <= 90;
    case 'v90mas': return v > 90;
  }
}

export default function CuentasPorPagar({
  projectId,
  projectName,
  onPaid,
}: {
  /** null = todas las urbanizaciones, incluida Administración. */
  projectId: string | null;
  projectName: string;
  onPaid: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const { cuentas } = useTesoreria();

  const [rows, setRows] = useState<Deuda[] | null>(null);
  const [tramo, setTramo] = useState<Tramo>('todo');
  const [busca, setBusca] = useState('');
  const [pagando, setPagando] = useState<Deuda | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    let q = supabase.from('v_cuentas_por_pagar').select('*');
    if (projectId !== null) q = q.eq('project_id', projectId);
    const { data } = await q.order('vencimiento', { ascending: true }).limit(2000);
    setRows((data ?? []) as unknown as Deuda[]);
  }, [supabase, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibles = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (rows ?? []).filter(
      (d) =>
        enTramo(d, tramo) &&
        (!t ||
          (d.proveedor ?? '').toLowerCase().includes(t) ||
          (d.numero_factura ?? '').toLowerCase().includes(t) ||
          d.detalle.toLowerCase().includes(t) ||
          d.numero.toLowerCase().includes(t)),
    );
  }, [rows, tramo, busca]);

  const total = (rows ?? []).reduce((s, d) => s + Number(d.monto), 0);
  const vencido = (rows ?? []).filter((d) => Number(d.dias_vencido) > 0);
  const totalVencido = vencido.reduce((s, d) => s + Number(d.monto), 0);
  const estaSemana = (rows ?? []).filter((d) => {
    if (!d.vencimiento || Number(d.dias_vencido) > 0) return false;
    const dias = Math.round(
      (new Date(`${d.vencimiento}T12:00:00`).getTime() - new Date(`${todayIso()}T12:00:00`).getTime()) /
        86400000,
    );
    return dias >= 0 && dias <= 7;
  });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Total por pagar"
          value={formatMoney(total, 'BOB')}
          hint="lo que se debe a proveedores"
          onClick={() => setTramo('todo')}
        />
        <Kpi
          label="Vencido"
          value={formatMoney(totalVencido, 'BOB')}
          hint={`${vencido.length} documento(s) pasados de fecha`}
          tone={totalVencido > 0 ? 'bad' : undefined}
          onClick={() => setTramo('v30')}
        />
        <Kpi
          label="Vence esta semana"
          value={formatMoney(estaSemana.reduce((s, d) => s + Number(d.monto), 0), 'BOB')}
          hint={`${estaSemana.length} documento(s)`}
          onClick={() => setTramo('por_vencer')}
        />
        <Kpi
          label="Documentos"
          value={String((rows ?? []).length)}
          hint="facturas y activos sin pagar"
          onClick={() => setTramo('todo')}
        />
      </div>

      <section className="rounded-xl border border-stone-200 bg-white">
        <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 px-4 py-3">
          <div>
            <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
              Cuentas por pagar
            </h2>
            <p className="mt-0.5 text-xs text-stone-500">
              Los egresos y activos comprados «a crédito» viven acá hasta que se cancelan.
            </p>
          </div>
          <div className="ml-auto">
            <ExportButtons
              disabled={!visibles.length}
              orientation="landscape"
              meta={{
                title: 'Cuentas por Pagar',
                subtitle: projectName,
                filename: `cuentas-por-pagar-${todayIso()}`,
                footnote: 'El total tiene que ser el saldo de 2.01.04.010 Proveedores por Pagar.',
              }}
              columns={[
                { header: 'Proveedor' },
                { header: 'Factura' },
                { header: 'Documento' },
                { header: 'Detalle' },
                { header: 'Urbanización' },
                { header: 'Fecha' },
                { header: 'Vence' },
                { header: 'Días', align: 'right' },
                { header: 'Monto', align: 'right' },
              ]}
              rows={() =>
                visibles.map((d) => [
                  d.proveedor ?? '—',
                  d.numero_factura ?? '',
                  d.numero,
                  d.detalle,
                  d.proyecto,
                  dateLabel(d.fecha),
                  d.vencimiento ? dateLabel(d.vencimiento) : '',
                  d.dias_vencido ? String(d.dias_vencido) : '',
                  num(Number(d.monto)),
                ]) as Cell[][]
              }
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-stone-100 px-4 py-2.5">
          {TRAMOS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTramo(t.id)}
              className={`cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                tramo === t.id ? 'bg-brand text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              {t.label}
            </button>
          ))}
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Proveedor, factura o detalle"
            className={`${inputClass} ml-auto w-56`}
            aria-label="Buscar en cuentas por pagar"
          />
        </div>

        {rows === null ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : !visibles.length ? (
          <div className="px-4 py-8">
            <EmptyState
              title={rows.length ? 'Nada en este tramo' : 'No hay cuentas por pagar'}
              hint={
                rows.length
                  ? 'Probá con otro tramo de vencimiento.'
                  : 'Los egresos y activos comprados «a crédito» aparecen acá hasta que los pagués.'
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-250 text-sm">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50 text-left">
                  <th className="px-4 py-2 text-xs font-semibold text-stone-500">Proveedor</th>
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">Factura</th>
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">Detalle</th>
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">Origen</th>
                  {projectId === null ? (
                    <th className="px-3 py-2 text-xs font-semibold text-stone-500">Urbanización</th>
                  ) : null}
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">Vence</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Monto</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {visibles.map((d) => (
                  <tr key={`${d.tipo}-${d.id}`} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                    <td className="px-4 py-2 text-stone-800">
                      {d.proveedor ?? <span className="text-stone-400">sin proveedor</span>}
                      {d.proveedor_nit ? (
                        <span className="block text-[11px] text-stone-500">NIT {d.proveedor_nit}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-stone-600">
                      {d.numero_factura ?? '—'}
                      <span className="block text-[11px] text-stone-400">{d.numero}</span>
                    </td>
                    <td className="px-3 py-2 text-stone-800">{d.detalle}</td>
                    <td className="px-3 py-2">
                      <Badge className={d.tipo === 'activo' ? 'bg-sky-100 text-sky-800' : 'bg-amber-100 text-amber-800'}>
                        {d.tipo === 'activo' ? 'Activo fijo' : 'Egreso'}
                      </Badge>
                    </td>
                    {projectId === null ? (
                      <td className="px-3 py-2 text-xs text-stone-500">{d.proyecto}</td>
                    ) : null}
                    <td className="px-3 py-2 whitespace-nowrap">
                      {d.vencimiento ? (
                        <span className={Number(d.dias_vencido) > 0 ? 'font-semibold text-red-600' : 'text-stone-600'}>
                          {dateLabel(d.vencimiento)}
                          {Number(d.dias_vencido) > 0 ? (
                            <span className="block text-[11px]">hace {d.dias_vencido} días</span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-stone-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {formatMoney(Number(d.monto), 'BOB')}
                      {Number(d.pagado) > 0 ? (
                        <span className="block text-[11px] font-normal text-stone-500">
                          de {formatMoney(Number(d.importe), 'BOB')} · abonado{' '}
                          {formatMoney(Number(d.pagado), 'BOB')}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" className={btnSecondary} onClick={() => setPagando(d)}>
                        Pagar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-stone-300 bg-stone-50 font-semibold">
                  <td className="px-4 py-2 text-xs text-stone-500" colSpan={projectId === null ? 6 : 5}>
                    {visibles.length} documento(s)
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatMoney(visibles.reduce((s, d) => s + Number(d.monto), 0), 'BOB')}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {pagando ? (
        <PagarDialog
          deuda={pagando}
          cuentas={cuentas}
          onClose={() => setPagando(null)}
          onPaid={() => {
            setPagando(null);
            void load();
            onPaid();
          }}
          push={push}
        />
      ) : null}
    </div>
  );
}

function PagarDialog({
  deuda,
  cuentas,
  onClose,
  onPaid,
  push,
}: {
  deuda: Deuda;
  cuentas: ReturnType<typeof useTesoreria>['cuentas'];
  onClose: () => void;
  onPaid: () => void;
  push: (m: string, t?: 'success' | 'error') => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [cuentaId, setCuentaId] = useState('');
  const [fecha, setFecha] = useState(todayIso);
  // Arranca con el saldo entero: pagar todo es lo normal, pagar una parte es
  // cambiar un número.
  const [monto, setMonto] = useState(String(Number(deuda.monto)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const aPagar = Number(monto) || 0;
  const queda = Math.round((Number(deuda.monto) - aPagar) * 100) / 100;

  async function pagar() {
    setError(null);
    if (!cuentaId) {
      setError('Elegí de qué caja o banco sale el pago.');
      return;
    }
    if (!(aPagar > 0)) {
      setError('El monto tiene que ser mayor a cero.');
      return;
    }
    if (queda < 0) {
      setError(`No se puede pagar más que el saldo: quedan ${formatMoney(Number(deuda.monto), 'BOB')}.`);
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.rpc(
      deuda.tipo === 'activo' ? 'admin_pagar_activo' : 'admin_pagar_egreso',
      deuda.tipo === 'activo'
        ? { p_activo_id: deuda.id, p_treasury_account_id: cuentaId, p_fecha: fecha, p_monto: aPagar }
        : { p_expense_id: deuda.id, p_treasury_account_id: cuentaId, p_fecha: fecha, p_monto: aPagar },
    );
    setBusy(false);
    if (err) {
      setError(adminErrorCopy(err.message));
      return;
    }
    push(
      queda > 0
        ? `Abono registrado. Quedan ${formatMoney(queda, 'BOB')} por pagar.`
        : `Pago registrado. La deuda con ${deuda.proveedor ?? 'el proveedor'} quedó saldada.`,
      'success',
    );
    onPaid();
  }

  return (
    <Dialog open onClose={onClose} title="Pagar al proveedor">
      <div className="space-y-3">
        <div className="rounded-lg bg-stone-50 p-3 text-sm">
          <p className="font-semibold text-stone-800">{deuda.detalle}</p>
          <p className="text-xs text-stone-600">
            {deuda.proveedor ?? 'Sin proveedor'}
            {deuda.numero_factura ? ` · Factura ${deuda.numero_factura}` : ''} · {deuda.numero}
          </p>
          <p className="mt-1 text-lg font-bold text-stone-900">
            {formatMoney(Number(deuda.monto), 'BOB')}
          </p>
          {Number(deuda.pagado) > 0 ? (
            <p className="text-xs text-stone-500">
              De {formatMoney(Number(deuda.importe), 'BOB')} ya se abonaron{' '}
              {formatMoney(Number(deuda.pagado), 'BOB')}.
            </p>
          ) : null}
        </div>

        <div>
          <label className="mb-1 block text-xs text-stone-500">¿Cuánto se paga? (Bs)</label>
          <input
            type="number"
            step="0.01"
            min={0}
            max={Number(deuda.monto)}
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            className={inputClass}
          />
          <p className="mt-1 text-[11px] text-stone-500">
            {queda > 0
              ? `Es un abono: quedarían ${formatMoney(queda, 'BOB')} por pagar.`
              : queda < 0
                ? 'No se puede pagar más que el saldo.'
                : 'Cancela la deuda entera.'}
          </p>
        </div>

        <CuentaSelect
          cuentas={cuentas}
          value={cuentaId}
          onChange={setCuentaId}
          label="¿De qué caja o banco sale?"
          monto={aPagar}
          signo={-1}
          atajoABancos
        />

        <div>
          <label className="mb-1 block text-xs text-stone-500">Fecha del pago</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputClass} />
        </div>

        <p className="text-[11px] text-stone-500">
          Asienta el pago: se debita 2.01.04.010 · Proveedores por Pagar y sale de la cuenta
          elegida. {queda > 0 ? 'El documento sigue acá por el saldo.' : 'El documento deja de figurar acá.'}
        </p>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Volver
        </button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void pagar()}>
          {busy ? 'Registrando…' : 'Registrar el pago'}
        </button>
      </div>
    </Dialog>
  );
}
