'use client';

// CÓMO SE PAGÓ: al contado, a crédito, o del fondo de alguien.
//
// Lo comparten el egreso y el activo fijo, porque es la misma pregunta y la
// misma consecuencia contable. Y la consecuencia se DICE acá, antes de
// guardar: la contadora pidió ver «las cuentas contables que serán
// relacionadas o afectadas si se pagó al contado o crédito», y el mejor
// momento para verlas es mientras se elige, no después en el mayor.
//
// Los códigos que se nombran son los mismos que asienta el libro. Si algún día
// cambian allá, cambian acá: no hay una segunda verdad, hay un cartel que
// anticipa la primera.

import { formatMoney } from '@/lib/format';
import { inputClass } from '@/features/admin/ui/bits';
import { CuentaSelect, type TreasuryAccount } from './Tesoreria';

export type FormaPago = 'contado' | 'credito' | 'fondos_por_rendir';

/** Las cuentas que acredita cada forma. Las mismas que el diario. */
export const CTA_PROVEEDORES = '2.01.04.010';
export const CTA_FONDOS = '1.02.04.030';

export const FORMA_PAGO_LABEL: Record<FormaPago, string> = {
  contado: 'Al contado',
  credito: 'A crédito',
  fondos_por_rendir: 'Fondos por rendir',
};

export interface FondoDePersona {
  empleado_id: string;
  nombre_completo: string;
  saldo: number;
}

export function FormaPagoPicker({
  value,
  onChange,
  cuentas,
  cuentaId,
  onCuentaId,
  vencimiento,
  onVencimiento,
  fondos,
  empleadoId,
  onEmpleadoId,
  monto,
  /** Qué cuenta se debita, para poder decir el asiento completo. */
  cuentaDebito,
  /** El activo no se compra «de un fondo por rendir». */
  conFondos = true,
}: {
  value: FormaPago;
  onChange: (v: FormaPago) => void;
  cuentas: TreasuryAccount[];
  cuentaId: string;
  onCuentaId: (id: string) => void;
  vencimiento: string;
  onVencimiento: (v: string) => void;
  fondos?: FondoDePersona[];
  empleadoId?: string;
  onEmpleadoId?: (id: string) => void;
  monto: number;
  cuentaDebito?: string | null;
  conFondos?: boolean;
}) {
  const opciones: FormaPago[] = conFondos
    ? ['contado', 'credito', 'fondos_por_rendir']
    : ['contado', 'credito'];

  const fondo = fondos?.find((f) => f.empleado_id === empleadoId);
  const quedaEnFondo = fondo ? Number(fondo.saldo) - Number(monto || 0) : 0;
  const debito = cuentaDebito ? `Se debita ${cuentaDebito} y ` : 'Se ';

  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50/60 p-3">
      <p className="mb-2 text-xs font-semibold text-stone-600">¿Cómo se pagó?</p>

      <div className="flex flex-wrap gap-2">
        {opciones.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            className={`cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              value === o
                ? 'bg-brand text-white'
                : 'bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-stone-100'
            }`}
          >
            {FORMA_PAGO_LABEL[o]}
          </button>
        ))}
      </div>

      <div className="mt-3">
        {value === 'contado' ? (
          <>
            <CuentaSelect
              cuentas={cuentas}
              value={cuentaId}
              onChange={onCuentaId}
              label="¿De qué caja o banco salió?"
              monto={monto}
              signo={-1}
            />
            <p className="mt-1 text-[11px] text-stone-500">
              {debito}acredita la cuenta elegida. Si no elegís ninguna, va a Caja.
            </p>
          </>
        ) : null}

        {value === 'credito' ? (
          <>
            <label className="mb-1 block text-xs text-stone-500">¿Cuándo vence?</label>
            <input
              type="date"
              value={vencimiento}
              onChange={(e) => onVencimiento(e.target.value)}
              className={inputClass}
            />
            <p className="mt-1 text-[11px] text-stone-500">
              {debito}acredita {CTA_PROVEEDORES} · Proveedores por Pagar. Queda en «Por pagar»
              hasta que la canceles.
            </p>
          </>
        ) : null}

        {value === 'fondos_por_rendir' ? (
          <>
            <label className="mb-1 block text-xs text-stone-500">¿De qué fondo sale?</label>
            <select
              value={empleadoId ?? ''}
              onChange={(e) => onEmpleadoId?.(e.target.value)}
              className={inputClass}
            >
              <option value="">— elegí a la persona —</option>
              {(fondos ?? []).map((f) => (
                <option key={f.empleado_id} value={f.empleado_id}>
                  {f.nombre_completo} · le quedan {formatMoney(Number(f.saldo), 'BOB')}
                </option>
              ))}
            </select>
            {fondo ? (
              <p
                className={`mt-1 text-[11px] ${
                  quedaEnFondo < 0 ? 'font-semibold text-red-600' : 'text-stone-500'
                }`}
              >
                {quedaEnFondo < 0
                  ? `No alcanza: el fondo de ${fondo.nombre_completo} tiene ${formatMoney(Number(fondo.saldo), 'BOB')}.`
                  : `Al fondo de ${fondo.nombre_completo} le quedarían ${formatMoney(quedaEnFondo, 'BOB')}.`}
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-stone-500">
                {!fondos?.length
                  ? 'Todavía no hay fondos entregados. Se entregan desde Bancos y caja.'
                  : 'La plata ya salió cuando se entregó el fondo: esto solo lo descarga.'}
              </p>
            )}
            <p className="mt-1 text-[11px] text-stone-500">
              {debito}acredita {CTA_FONDOS} · Fondos por Rendir.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
