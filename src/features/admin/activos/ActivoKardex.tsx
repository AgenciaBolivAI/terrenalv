'use client';

// EL KARDEX DEL ACTIVO: su ficha completa en una hoja.
//
// La contadora pidió el activo «tipo kardex»: quién lo vendió, con qué
// factura, cuánto costó, qué cuentas mueve y cómo se va gastando. Esto es esa
// hoja.
//
// El cuadro de depreciación se proyecta acá, en el navegador, y va por GESTIÓN
// y no por mes: una edificación a 40 años son 480 renglones mensuales que
// nadie lee. Las cifras de HOY —acumulada y valor en libros— salen siempre de
// la vista, que es la que manda; el cuadro solo dice hacia dónde va.

import { formatMoney } from '@/lib/format';
import { Badge, btnPrimary, btnSecondary } from '@/features/admin/ui/bits';
import { Dialog } from '@/features/admin/ui/dialog';
import { ExportButtons } from '@/features/admin/export/ExportButtons';
import { num, type Cell } from '@/features/admin/export';
import { dateLabel } from '@/features/admin/contabilidad/types';
import { cuadroAnual, ESTADO_ACTIVO, type Activo } from './tipos';

function Dato({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] tracking-wide text-stone-500 uppercase">{rotulo}</p>
      <p className="mt-0.5 text-sm text-stone-900">{children}</p>
    </div>
  );
}

export function ActivoKardex({
  activo,
  onClose,
  onEditar,
}: {
  activo: Activo;
  onClose: () => void;
  onEditar: () => void;
}) {
  const cuadro = cuadroAnual(activo);
  const gestionActual = new Date().getFullYear();
  const aCredito = activo.forma_pago === 'credito';

  return (
    <Dialog open onClose={onClose} wide title={`Kardex — ${activo.codigo} · ${activo.nombre}`}>
      <div className="space-y-4">
        {/* La compra */}
        <section className="rounded-lg bg-stone-50 p-3">
          <p className="mb-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">
            La compra
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Dato rotulo="Proveedor">
              {activo.proveedor ?? <span className="text-stone-400">sin proveedor</span>}
              {activo.proveedor_nit ? (
                <span className="block text-[11px] text-stone-500">NIT {activo.proveedor_nit}</span>
              ) : null}
            </Dato>
            <Dato rotulo="N° de factura">
              {activo.numero_factura ?? <span className="text-stone-400">sin factura</span>}
            </Dato>
            <Dato rotulo="Fecha de compra">{dateLabel(activo.fecha_compra)}</Dato>
            <Dato rotulo="Costo">{formatMoney(Number(activo.costo), 'BOB')}</Dato>
            <Dato rotulo="Valor residual">
              {formatMoney(Number(activo.valor_residual), 'BOB')}
            </Dato>
            <Dato rotulo="Forma de pago">
              {aCredito ? (
                activo.pagado_el ? (
                  <Badge className="bg-green-100 text-green-700">
                    a crédito · pagada el {dateLabel(activo.pagado_el)}
                  </Badge>
                ) : (
                  <Badge className="bg-amber-100 text-amber-800">
                    a crédito · vence {activo.vencimiento ? dateLabel(activo.vencimiento) : 's/f'}
                  </Badge>
                )
              ) : (
                <>
                  Al contado
                  {activo.comprado_de ? (
                    <span className="block text-[11px] text-stone-500">
                      de {activo.comprado_de}
                    </span>
                  ) : null}
                </>
              )}
            </Dato>
            <Dato rotulo="Categoría">{activo.categoria}</Dato>
            <Dato rotulo="Identificación">
              {activo.identificacion ?? <span className="text-stone-400">—</span>}
            </Dato>
            <Dato rotulo="Centro de costos">
              {activo.centro_costo ?? <span className="text-stone-400">sin centro</span>}
            </Dato>
            <Dato rotulo="Urbanización">{activo.proyecto ?? '—'}</Dato>
            <Dato rotulo="A nombre de">
              {activo.titular === 'tercero' ? activo.titular_nombre : 'La empresa'}
            </Dato>
            <Dato rotulo="Estado">
              {ESTADO_ACTIVO[activo.estado] ?? activo.estado}
            </Dato>
          </div>
          {activo.descripcion || activo.nota ? (
            <p className="mt-2 border-t border-stone-200 pt-2 text-xs text-stone-600">
              {[activo.descripcion, activo.nota].filter(Boolean).join(' · ')}
            </p>
          ) : null}
        </section>

        {/* Las cuentas */}
        <section className="rounded-lg border border-stone-200 p-3">
          <p className="mb-1 text-xs font-semibold tracking-wide text-stone-500 uppercase">
            Cuentas que mueve
          </p>
          <p className="font-mono text-xs text-stone-600">
            Activo {activo.cuenta_activo ?? '—'} · Gasto de depreciación{' '}
            {activo.cuenta_depreciacion ?? '—'} · Depreciación acumulada{' '}
            {activo.cuenta_acumulada ?? '—'}
          </p>
          <p className="mt-1 text-[11px] text-stone-500">
            La compra se asentó al registrarlo. «Contabilizar depreciación del mes» asienta{' '}
            {activo.cuenta_depreciacion ?? '5811'} contra {activo.cuenta_acumulada ?? '1290'}, un
            renglón por activo.
          </p>
        </section>

        {/* Cómo se va gastando */}
        <section className="rounded-lg border border-stone-200">
          <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 px-3 py-2">
            <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
              Depreciación por gestión
            </p>
            <span className="text-[11px] text-stone-500">
              línea recta · {activo.vida_util_meses} meses ·{' '}
              {formatMoney(Number(activo.mensual), 'BOB')} por mes
            </span>
            <div className="ml-auto">
              <ExportButtons
                meta={{
                  title: `Kardex de activo — ${activo.codigo}`,
                  subtitle: `${activo.nombre}${activo.proyecto ? ` · ${activo.proyecto}` : ''}`,
                  filename: `kardex-${activo.codigo}`,
                  footnote:
                    'Cuadro proyectado en línea recta. Las cifras del día de hoy salen del libro.',
                }}
                columns={[
                  { header: 'Gestión' },
                  { header: 'Meses', align: 'right' },
                  { header: 'Depreciación', align: 'right' },
                  { header: 'Acumulada', align: 'right' },
                  { header: 'Valor en libros', align: 'right' },
                ]}
                rows={() =>
                  cuadro.map((f) => [
                    String(f.gestion),
                    String(f.meses),
                    num(f.depreciacion),
                    num(f.acumulada),
                    num(f.enLibros),
                  ]) as Cell[][]
                }
              />
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-stone-50">
                <tr className="border-b border-stone-200 text-left">
                  <th className="px-3 py-2 text-xs font-semibold text-stone-500">Gestión</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Meses</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Depreciación
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Acumulada
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                    Valor en libros
                  </th>
                </tr>
              </thead>
              <tbody>
                {cuadro.map((f) => (
                  <tr
                    key={f.gestion}
                    className={`border-b border-stone-100 last:border-0 ${
                      f.gestion === gestionActual ? 'bg-green-50 font-medium' : ''
                    }`}
                  >
                    <td className="px-3 py-1.5 text-stone-800">
                      {f.gestion}
                      {f.gestion === gestionActual ? (
                        <span className="ml-1 text-[11px] text-green-700">en curso</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-stone-500">{f.meses}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-stone-600">
                      {formatMoney(f.depreciacion, 'BOB')}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-stone-600">
                      {formatMoney(f.acumulada, 'BOB')}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-stone-900">
                      {formatMoney(f.enLibros, 'BOB')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-stone-100 px-3 py-2 text-[11px] text-stone-500">
            Al día de hoy lleva depreciado {formatMoney(Number(activo.acumulada), 'BOB')} y vale{' '}
            {formatMoney(Number(activo.valor_en_libros), 'BOB')} en libros ({activo.meses_corridos}{' '}
            de {activo.vida_util_meses} meses).
          </p>
        </section>

        {activo.estado !== 'activo' ? (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="mb-2 text-xs font-semibold tracking-wide text-amber-800 uppercase">
              Cómo terminó
            </p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Dato rotulo="Fecha de baja">
                {activo.fecha_baja ? dateLabel(activo.fecha_baja) : '—'}
              </Dato>
              <Dato rotulo="Motivo">{activo.motivo_baja ?? '—'}</Dato>
              <Dato rotulo="Valor de venta">
                {activo.valor_venta ? formatMoney(Number(activo.valor_venta), 'BOB') : '—'}
              </Dato>
              <Dato rotulo="Depreciación al dar de baja">
                {activo.dep_acumulada_baja !== null
                  ? formatMoney(Number(activo.dep_acumulada_baja), 'BOB')
                  : '—'}
              </Dato>
            </div>
          </section>
        ) : null}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Volver
        </button>
        {activo.estado === 'activo' ? (
          <button type="button" className={btnPrimary} onClick={onEditar}>
            Editar
          </button>
        ) : null}
      </div>
    </Dialog>
  );
}
