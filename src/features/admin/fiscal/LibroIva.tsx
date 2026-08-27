'use client';

// LIBRO DE COMPRAS Y VENTAS IVA — la pantalla.
//
// Compras con factura generan crédito fiscal; ventas, débito. IVA 13% POR
// DENTRO (una factura de 1.000 trae 130). Desde el umbral de bancarización
// (Bs 50.000, editable) la factura exige el medio de pago bancario o el
// sistema no la deja entrar. El export sale con las columnas del RCV.

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
import type { Cell as XCell } from '@/features/admin/export';

interface Factura {
  id: string;
  project_id: string;
  tipo: 'compra' | 'venta';
  fecha: string;
  periodo: string;
  nit: string;
  razon_social: string;
  numero_factura: string;
  codigo_autorizacion: string | null;
  importe_total: number;
  importe_exento: number;
  descuentos: number;
  base_credito_debito: number;
  tasa_iva: number;
  iva: number;
  requiere_bancarizacion: boolean;
  medio_pago: string | null;
  nro_documento_pago: string | null;
  estado: 'valida' | 'anulada';
}

interface Posicion {
  periodo: string;
  debito_fiscal: number | null;
  credito_fiscal: number | null;
  saldo_a_pagar: number;
  facturas_venta: number;
  facturas_compra: number;
}

export default function LibroIva() {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const { projectId, projectName } = useAdmin();

  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [posiciones, setPosiciones] = useState<Posicion[]>([]);
  const [loading, setLoading] = useState(true);
  const [tipo, setTipo] = useState<'compra' | 'venta'>('compra');
  const [alta, setAlta] = useState<Record<string, string> | null>(null);

  const cargar = useCallback(async () => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    const [f, p] = await Promise.all([
      supabase
        .from('v_fiscal_libro_iva')
        .select('*')
        .eq('project_id', projectId)
        .order('fecha', { ascending: false })
        .limit(2000),
      supabase
        .from('v_fiscal_posicion_iva')
        .select('*')
        .eq('project_id', projectId)
        .order('periodo', { ascending: false })
        .limit(13),
    ]);
    setFacturas((f.data ?? []) as unknown as Factura[]);
    setPosiciones((p.data ?? []) as unknown as Posicion[]);
    setLoading(false);
  }, [supabase, projectId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const delTipo = useMemo(() => facturas.filter((f) => f.tipo === tipo), [facturas, tipo]);
  const mesActual = posiciones[0];

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Débito fiscal (mes)"
          value={formatMoney(Number(mesActual?.debito_fiscal ?? 0), 'BOB')}
          hint="IVA de las ventas facturadas"
          onClick={() => setTipo('venta')}
        />
        <Kpi
          label="Crédito fiscal (mes)"
          value={formatMoney(Number(mesActual?.credito_fiscal ?? 0), 'BOB')}
          tone="good"
          hint="IVA de las compras con factura"
          onClick={() => setTipo('compra')}
        />
        <Kpi
          label={Number(mesActual?.saldo_a_pagar ?? 0) >= 0 ? 'IVA a pagar (mes)' : 'Saldo a favor (mes)'}
          value={formatMoney(Math.abs(Number(mesActual?.saldo_a_pagar ?? 0)), 'BOB')}
          tone={Number(mesActual?.saldo_a_pagar ?? 0) > 0 ? 'bad' : 'good'}
          hint="débito menos crédito"
          onClick={() => setTipo('venta')}
        />
        <Kpi
          label="Facturas del mes"
          value={String(
            Number(mesActual?.facturas_venta ?? 0) + Number(mesActual?.facturas_compra ?? 0),
          )}
          hint={`${mesActual?.facturas_compra ?? 0} compras · ${mesActual?.facturas_venta ?? 0} ventas`}
          onClick={() => setTipo('compra')}
        />
      </div>

      <section className="rounded-xl border border-stone-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 px-4 py-3">
          <div className="flex gap-1 rounded-lg border border-stone-200 bg-stone-50 p-1">
            {(['compra', 'venta'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTipo(t)}
                className={`rounded-md px-3 py-1 text-sm font-medium ${
                  tipo === t ? 'bg-white text-brand shadow-sm' : 'text-stone-600'
                }`}
              >
                {t === 'compra' ? 'Libro de compras' : 'Libro de ventas'}
              </button>
            ))}
          </div>
          <div className="ml-auto flex gap-2">
            <ExportButtons
              disabled={!delTipo.length}
              orientation="landscape"
              meta={{
                title: tipo === 'compra' ? 'Registro de compras (RCV)' : 'Registro de ventas (RCV)',
                subtitle: `Terrenalv S.R.L. · ${projectName}`,
                filename: `rcv-${tipo}s-${new Date().toISOString().slice(0, 10)}`,
                footnote:
                  'IVA 13% por dentro sobre (importe − exento − descuentos). Cada factura guarda su propia tasa. Bancarización: desde el umbral vigente la factura lleva su medio de pago bancario.',
              }}
              columns={[
                { header: 'Fecha' },
                { header: 'NIT' },
                { header: 'Razón social' },
                { header: 'N° factura' },
                { header: 'Cód. autorización' },
                { header: 'Importe total', align: 'right' },
                { header: 'Exento', align: 'right' },
                { header: 'Descuentos', align: 'right' },
                { header: 'Base', align: 'right' },
                { header: tipo === 'compra' ? 'Crédito fiscal' : 'Débito fiscal', align: 'right' },
                { header: 'Medio de pago' },
                { header: 'Doc. pago' },
                { header: 'Estado' },
              ]}
              rows={() =>
                delTipo.map((f) => [
                  dateLabel(f.fecha),
                  f.nit,
                  f.razon_social,
                  f.numero_factura,
                  f.codigo_autorizacion ?? '',
                  Number(f.importe_total),
                  Number(f.importe_exento),
                  Number(f.descuentos),
                  Number(f.base_credito_debito),
                  Number(f.iva),
                  f.medio_pago ?? '',
                  f.nro_documento_pago ?? '',
                  f.estado,
                ]) as XCell[][]
              }
            />
            <button
              type="button"
              className={btnPrimary}
              onClick={() =>
                setAlta({
                  tipo,
                  fecha: new Date().toISOString().slice(0, 10),
                  nit: '',
                  razon_social: '',
                  numero_factura: '',
                  codigo_autorizacion: '',
                  importe_total: '',
                  importe_exento: '0',
                  descuentos: '0',
                  medio_pago: '',
                  nro_documento_pago: '',
                })
              }
            >
              Registrar factura
            </button>
          </div>
        </div>

        {delTipo.length === 0 ? (
          <div className="px-4 py-8">
            <EmptyState
              title={`Sin facturas de ${tipo === 'compra' ? 'compra' : 'venta'} registradas`}
              hint="Registrá cada factura y el crédito o débito fiscal se calcula solo."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50 text-left">
                  <th className="px-4 py-2 text-xs font-semibold text-stone-500">Fecha</th>
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">NIT</th>
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">Razón social</th>
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">N° factura</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Importe
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    {tipo === 'compra' ? 'Crédito' : 'Débito'} fiscal
                  </th>
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">Bancarización</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {delTipo.map((f) => (
                  <tr
                    key={f.id}
                    className={`border-b border-stone-100 last:border-0 ${
                      f.estado === 'anulada' ? 'opacity-50' : ''
                    }`}
                  >
                    <td className="px-4 py-2 whitespace-nowrap text-stone-600">
                      {dateLabel(f.fecha)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{f.nit}</td>
                    <td className="px-3 py-2 text-stone-800">{f.razon_social}</td>
                    <td className="px-3 py-2 font-mono text-xs">{f.numero_factura}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMoney(Number(f.importe_total), 'BOB')}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-brand">
                      {formatMoney(Number(f.iva), 'BOB')}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {f.requiere_bancarizacion ? (
                        <Badge className="bg-green-100 text-green-700">
                          {f.medio_pago} {f.nro_documento_pago ? `· ${f.nro_documento_pago}` : ''}
                        </Badge>
                      ) : (
                        <span className="text-stone-400">no requiere</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {f.estado === 'valida' ? (
                        <button
                          type="button"
                          className="text-xs text-stone-400 hover:text-red-600"
                          onClick={async () => {
                            const nota = window.prompt(
                              `Anular la factura ${f.numero_factura} de ${f.razon_social}. ¿Por qué?`,
                            );
                            if (!nota?.trim()) return;
                            const { error } = await supabase.rpc('fiscal_anular_factura', {
                              p_id: f.id,
                              p_nota: nota.trim(),
                            });
                            if (error) {
                              push(adminErrorCopy(error.message), 'error');
                              return;
                            }
                            push('Factura anulada.', 'success');
                            void cargar();
                          }}
                        >
                          Anular
                        </button>
                      ) : (
                        <Badge className="bg-stone-200 text-stone-600">anulada</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-stone-100 px-4 py-2.5 text-xs text-stone-400">
          Posición del mes: débito − crédito = IVA a pagar (negativo = saldo a favor). La tasa y
          el umbral de bancarización viven en parámetros; cada factura guarda su propia tasa, así
          el libro histórico no cambia si la norma cambia.
        </p>
      </section>

      {/* ---- registrar factura ---- */}
      {alta ? (
        <Dialog
          open
          onClose={() => setAlta(null)}
          wide
          title={alta.tipo === 'compra' ? 'Factura de compra' : 'Factura de venta'}
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-stone-500">Fecha</label>
              <input
                type="date"
                value={alta.fecha}
                onChange={(e) => setAlta({ ...alta, fecha: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">NIT / CI</label>
              <input
                value={alta.nit}
                onChange={(e) => setAlta({ ...alta, nit: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">Razón social</label>
              <input
                value={alta.razon_social}
                onChange={(e) => setAlta({ ...alta, razon_social: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">N° de factura</label>
              <input
                value={alta.numero_factura}
                onChange={(e) => setAlta({ ...alta, numero_factura: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">Código de autorización</label>
              <input
                value={alta.codigo_autorizacion}
                onChange={(e) => setAlta({ ...alta, codigo_autorizacion: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">Importe total (Bs)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={alta.importe_total}
                onChange={(e) => setAlta({ ...alta, importe_total: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">Importe exento (Bs)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={alta.importe_exento}
                onChange={(e) => setAlta({ ...alta, importe_exento: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">Descuentos (Bs)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={alta.descuentos}
                onChange={(e) => setAlta({ ...alta, descuentos: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">
                Medio de pago (obligatorio desde el umbral)
              </label>
              <select
                value={alta.medio_pago}
                onChange={(e) => setAlta({ ...alta, medio_pago: e.target.value })}
                className={inputClass}
              >
                <option value="">— efectivo / no aplica —</option>
                <option value="transferencia">Transferencia</option>
                <option value="cheque">Cheque</option>
                <option value="deposito">Depósito</option>
                <option value="tarjeta">Tarjeta</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">N° de documento de pago</label>
              <input
                value={alta.nro_documento_pago}
                onChange={(e) => setAlta({ ...alta, nro_documento_pago: e.target.value })}
                className={inputClass}
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={btnSecondary} onClick={() => setAlta(null)}>
              Volver
            </button>
            <button
              type="button"
              className={btnPrimary}
              onClick={async () => {
                const { data, error } = await supabase.rpc('fiscal_registrar_factura', {
                  p_project_id: projectId,
                  p_tipo: alta.tipo,
                  p_fecha: alta.fecha,
                  p_nit: alta.nit,
                  p_razon_social: alta.razon_social,
                  p_numero_factura: alta.numero_factura,
                  p_codigo_autorizacion: alta.codigo_autorizacion || null,
                  p_importe_total: Number(alta.importe_total) || 0,
                  p_importe_exento: Number(alta.importe_exento) || 0,
                  p_descuentos: Number(alta.descuentos) || 0,
                  p_medio_pago: alta.medio_pago || null,
                  p_nro_documento_pago: alta.nro_documento_pago || null,
                  p_origen: null,
                  p_origen_id: null,
                  p_nota: null,
                });
                if (error) {
                  push(adminErrorCopy(error.message), 'error');
                  return;
                }
                const d = data as { iva?: number } | null;
                push(
                  `Factura registrada: ${alta.tipo === 'compra' ? 'crédito' : 'débito'} fiscal ${formatMoney(Number(d?.iva ?? 0), 'BOB')}.`,
                  'success',
                );
                setAlta(null);
                void cargar();
              }}
            >
              Registrar
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
