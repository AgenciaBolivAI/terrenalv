'use client';

// Quién vendió qué, cuánto ganó y cuánto se le debe.
//
// La comisión se gana como se pacta: sobre el PRECIO (todo al firmar) o sobre
// lo COBRADO (de a poco, a medida que el comprador paga). Sobre una venta a
// 120 meses la segunda es la honesta — reconocer toda la comisión el primer
// día es pagar sobre plata que todavía no entró.
//
// Pagar una comisión es un EGRESO de verdad (cuenta 5211): sale de una caja,
// aparece en el libro y en el estado de resultados. Nada de listas paralelas
// que después nadie concilia.

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
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
import { CuentaSelect, useTesoreria } from '@/features/admin/contabilidad/Tesoreria';
import { dateLabel } from '@/features/admin/contabilidad/types';
import { ExportButtons } from '@/features/admin/export/ExportButtons';
import { num as fnum, type Cell as XCell } from '@/features/admin/export';

interface Vendedor {
  profile_id: string;
  vendedor: string;
  rol: string;
  ventas: number;
  valor_vendido: number;
  cobrado_de_sus_ventas: number;
  ganado: number;
  pagado: number;
  por_pagar: number;
  ultima_venta: string | null;
}

interface Comision {
  reservation_id: string;
  proyecto: string;
  tracking_code: string;
  estado: string;
  fecha_venta: string | null;
  manzana: string | null;
  lote: string | null;
  comprador: string;
  profile_id: string;
  vendedor: string;
  pct: number;
  base: string;
  precio: number;
  cobrado: number;
  ganado: number;
  pagado: number;
  por_pagar: number;
}

export default function ComisionesClient() {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [detalle, setDetalle] = useState<Comision[]>([]);
  const [loading, setLoading] = useState(true);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [pagando, setPagando] = useState<Comision | null>(null);
  const [soloPendientes, setSoloPendientes] = useState(false);

  const cargar = useCallback(async () => {
    const [v, d] = await Promise.all([
      supabase.from('v_comisiones_por_vendedor').select('*').order('por_pagar', { ascending: false }),
      supabase.from('v_comisiones').select('*').order('fecha_venta', { ascending: false }),
    ]);
    setVendedores((v.data ?? []) as unknown as Vendedor[]);
    setDetalle((d.data ?? []) as unknown as Comision[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const totales = useMemo(
    () => ({
      ganado: vendedores.reduce((s, v) => s + Number(v.ganado), 0),
      pagado: vendedores.reduce((s, v) => s + Number(v.pagado), 0),
      porPagar: vendedores.reduce((s, v) => s + Number(v.por_pagar), 0),
      conVentas: vendedores.filter((v) => Number(v.ventas) > 0).length,
      sinVendedor: 0,
    }),
    [vendedores],
  );

  const visibles = useMemo(
    () => (soloPendientes ? vendedores.filter((v) => Number(v.por_pagar) > 0) : vendedores),
    [vendedores, soloPendientes],
  );

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
        <h1 className="text-lg font-bold text-stone-900">Comisiones</h1>
        <p className="text-xs text-stone-500">
          Quién vendió qué, cuánto ganó y cuánto se le debe.
        </p>
        <Link href="/admin/financiamiento" className={`${btnSecondary} ml-auto`}>
          Reglas y porcentajes
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Vendedores con ventas"
          value={String(totales.conVentas)}
          hint="del equipo activo"
          onClick={() => setSoloPendientes(false)}
        />
        <Kpi
          label="Comisión ganada"
          value={formatMoney(totales.ganado, 'BOB')}
          tone="good"
          hint="según lo pactado en cada venta"
          onClick={() => setSoloPendientes(false)}
        />
        <Kpi
          label="Ya pagado"
          value={formatMoney(totales.pagado, 'BOB')}
          hint="egresos de comisiones (cuenta 5211)"
          onClick={() => setSoloPendientes(false)}
        />
        <Kpi
          label="Se les debe"
          value={formatMoney(totales.porPagar, 'BOB')}
          tone={totales.porPagar > 0 ? 'bad' : 'normal'}
          hint="pendiente de pagar — ver"
          onClick={() => setSoloPendientes(true)}
        />
      </div>

      <section className="rounded-xl border border-stone-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 px-4 py-3">
          <button
            type="button"
            onClick={() => setSoloPendientes(false)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              !soloPendientes ? 'bg-brand text-white' : 'bg-stone-100 text-stone-600'
            }`}
          >
            Todo el equipo
          </button>
          <button
            type="button"
            onClick={() => setSoloPendientes(true)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              soloPendientes ? 'bg-brand text-white' : 'bg-stone-100 text-stone-600'
            }`}
          >
            Con comisión pendiente
          </button>
          <ExportButtons
            disabled={!detalle.length}
            orientation="landscape"
            meta={{
              title: 'Comisiones por venta',
              subtitle: 'Terrenalv S.R.L.',
              filename: `comisiones-${new Date().toISOString().slice(0, 10)}`,
              footnote:
                'Base «cobrado»: la comisión se gana a medida que el comprador paga capital. Base «precio»: se gana entera al firmar.',
            }}
            columns={[
              { header: 'Vendedor' },
              { header: 'Venta' },
              { header: 'Lote' },
              { header: 'Comprador' },
              { header: 'Precio', align: 'right' },
              { header: 'Cobrado', align: 'right' },
              { header: '%', align: 'right' },
              { header: 'Base' },
              { header: 'Ganado', align: 'right' },
              { header: 'Pagado', align: 'right' },
              { header: 'Se le debe', align: 'right' },
            ]}
            rows={() =>
              detalle.map((c) => [
                c.vendedor,
                c.tracking_code,
                `Mz ${c.manzana ?? '—'} L ${c.lote ?? '—'}`,
                c.comprador,
                fnum(Number(c.precio)),
                fnum(Number(c.cobrado)),
                fnum(Number(c.pct), 2),
                c.base,
                fnum(Number(c.ganado)),
                fnum(Number(c.pagado)),
                fnum(Number(c.por_pagar)),
              ]) as XCell[][]
            }
          />
        </div>

        {visibles.length === 0 ? (
          <div className="px-4 py-8">
            <EmptyState
              title="Nadie tiene comisiones pendientes"
              hint="Asigná el vendedor en cada venta (desde Ventas → detalle) y acá aparecerá lo que le toca."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50 text-left">
                  <th className="px-4 py-2 text-xs font-semibold text-stone-500">Vendedor</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Ventas
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Vendió
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Ganó
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Pagado
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Se le debe
                  </th>
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">Últ. venta</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((v) => (
                  <Fragment key={v.profile_id}>
                    <tr
                      onClick={() => setAbierto(abierto === v.profile_id ? null : v.profile_id)}
                      className={`cursor-pointer border-b border-stone-100 last:border-0 hover:bg-stone-50 ${
                        abierto === v.profile_id ? 'bg-green-50/60' : ''
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-stone-900">{v.vendedor}</p>
                        <p className="text-xs text-stone-400">{v.rol}</p>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{v.ventas}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-stone-600">
                        {formatMoney(Number(v.valor_vendido), 'BOB')}
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-brand">
                        {formatMoney(Number(v.ganado), 'BOB')}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-stone-600">
                        {formatMoney(Number(v.pagado), 'BOB')}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-semibold tabular-nums ${
                          Number(v.por_pagar) > 0 ? 'text-red-600' : 'text-stone-900'
                        }`}
                      >
                        {formatMoney(Number(v.por_pagar), 'BOB')}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-stone-400">
                        {v.ultima_venta ? dateLabel(v.ultima_venta) : '—'}
                      </td>
                    </tr>

                    {abierto === v.profile_id ? (
                      <tr className="border-b border-stone-100 bg-stone-50/70 last:border-0">
                        <td colSpan={7} className="px-4 py-3">
                          <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                            Sus ventas
                          </p>
                          {detalle.filter((c) => c.profile_id === v.profile_id).length === 0 ? (
                            <p className="mt-2 text-sm text-stone-500">
                              Todavía no tiene ventas asignadas.
                            </p>
                          ) : (
                            <ul className="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
                              {detalle
                                .filter((c) => c.profile_id === v.profile_id)
                                .map((c) => (
                                  <li
                                    key={c.reservation_id}
                                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
                                  >
                                    <Link
                                      href={`/admin/ventas?open=${c.reservation_id}`}
                                      className="font-mono text-xs font-semibold text-brand hover:underline"
                                    >
                                      {c.tracking_code}
                                    </Link>
                                    <span className="text-stone-700">
                                      Mz {c.manzana ?? '—'}, Lote {c.lote ?? '—'}
                                    </span>
                                    <span className="text-xs text-stone-400">{c.comprador}</span>
                                    <Badge className="bg-stone-100 text-stone-600">
                                      {Number(c.pct)}% sobre {c.base}
                                    </Badge>
                                    <span className="text-xs text-stone-500">
                                      cobrado {formatMoney(Number(c.cobrado), 'BOB')}
                                    </span>
                                    <span className="ml-auto font-semibold tabular-nums text-brand">
                                      {formatMoney(Number(c.ganado), 'BOB')}
                                    </span>
                                    {Number(c.por_pagar) > 0 ? (
                                      <button
                                        type="button"
                                        className="rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-white"
                                        onClick={() => setPagando(c)}
                                      >
                                        Pagar {formatMoney(Number(c.por_pagar), 'BOB')}
                                      </button>
                                    ) : (
                                      <Badge className="bg-green-100 text-green-700">al día</Badge>
                                    )}
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
            </table>
          </div>
        )}
        <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-400">
          Base <strong>cobrado</strong>: la comisión se gana a medida que el comprador paga capital
          — sobre una venta a 120 meses, reconocerla entera el primer día sería pagar sobre plata
          que no entró. Base <strong>precio</strong>: se gana entera al firmar. El porcentaje queda
          congelado en cada venta: cambiar la regla no reescribe lo ya pactado.
        </p>
      </section>

      {pagando ? (
        <PagarComisionDialog
          c={pagando}
          onClose={() => setPagando(null)}
          onPaid={() => {
            setPagando(null);
            void cargar();
          }}
        />
      ) : null}
    </div>
  );
}

/* ========================================================================== */

function PagarComisionDialog({
  c,
  onClose,
  onPaid,
}: {
  c: Comision;
  onClose: () => void;
  onPaid: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const { cuentas } = useTesoreria();
  const [monto, setMonto] = useState(String(c.por_pagar));
  const [cuentaId, setCuentaId] = useState('');
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [nota, setNota] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pagar() {
    setError(null);
    const m = Number(monto);
    if (!(m > 0)) {
      setError('El monto debe ser mayor a cero.');
      return;
    }
    if (m > Number(c.por_pagar) + 0.01) {
      setError(
        `No se puede pagar más de lo ganado: quedan ${formatMoney(Number(c.por_pagar), 'BOB')}.`,
      );
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.rpc('admin_pagar_comision', {
      p_reservation_id: c.reservation_id,
      p_amount: m,
      p_treasury_account_id: cuentaId || null,
      p_paid_on: fecha,
      p_note: nota.trim() || null,
    });
    setBusy(false);
    if (err) {
      setError(adminErrorCopy(err.message));
      return;
    }
    push('Comisión pagada y registrada como egreso.', 'success');
    onPaid();
  }

  return (
    <Dialog open onClose={onClose} title={`Pagar comisión — ${c.vendedor}`}>
      <div className="space-y-3">
        <p className="rounded-lg bg-stone-50 p-3 text-sm text-stone-600">
          Venta <span className="font-mono">{c.tracking_code}</span> · Mz {c.manzana ?? '—'}, Lote{' '}
          {c.lote ?? '—'} · {c.comprador}.
          <br />
          {Number(c.pct)}% sobre {c.base === 'precio' ? 'el precio' : 'lo cobrado'} (
          {formatMoney(Number(c.base === 'precio' ? c.precio : c.cobrado), 'BOB')}) ={' '}
          <strong>{formatMoney(Number(c.ganado), 'BOB')}</strong>. Ya se le pagó{' '}
          {formatMoney(Number(c.pagado), 'BOB')}.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Monto a pagar (Bs)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">Fecha</label>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
        <CuentaSelect
          cuentas={cuentas}
          value={cuentaId}
          onChange={setCuentaId}
          label="Sale de"
          monto={Number(monto) || 0}
          signo={-1}
        />
        <textarea
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          rows={2}
          placeholder="Nota (opcional)"
          className={inputClass}
        />
        <p className="text-xs text-stone-400">
          Queda como egreso de categoría «comisiones» (cuenta 5211): aparece en el libro, en el
          estado de resultados y baja el saldo de la caja de donde sale.
        </p>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Volver
        </button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void pagar()}>
          {busy ? 'Pagando…' : 'Registrar pago'}
        </button>
      </div>
    </Dialog>
  );
}
