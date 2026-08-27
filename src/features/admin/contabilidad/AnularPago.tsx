'use client';

// Anular UN pago — no toda la venta: una cuota cobrada de más, un cobro
// duplicado, un pago que se registró mal.
//
// Dos maneras, porque son dos cosas distintas y el asiento es distinto:
//
//   · ERROR DE REGISTRO: la plata nunca entró (se cargó dos veces, se eligió
//     mal la venta). El pago se cancela y desaparece del libro; la deuda y las
//     cuotas vuelven solas. No hay devolución que registrar.
//
//   · ANULACIÓN CON DEVOLUCIÓN: la plata SÍ entró y se devuelve todo, parte o
//     nada — el monto es editable. Lo que no se devuelve queda como ingreso
//     (4911) y el comprobante de ajuste se emite solo.
//
// Vive en su propio archivo porque anula desde DOS pantallas — el historial
// del lote y el detalle de Ventas — y dos copias divergirían.

import { useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/format';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';
import { btnPrimary, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { Dialog } from '@/features/admin/ui/dialog';
import { useToast } from '@/features/admin/ui/toast';
import { CuentaSelect, useTesoreria } from './Tesoreria';

/** El pago que se quiere anular: lo mínimo para decidir y confirmar. */
export interface PagoAnulable {
  payment_id: string;
  /** Bs que sumó al libro (amount_bob): tope de la devolución. */
  monto_bob: number;
  /** Etiqueta humana: «cuota · Bs 4.125 · 12/05/2026». */
  etiqueta: string;
}

const COPY_EXTRA: Record<string, string> = {
  PAGO_NO_APROBADO: 'Solo se anula un pago aprobado: los demás nunca sumaron al saldo.',
  DEVOLUCION_INVALIDA: 'Lo devuelto no puede superar lo que pagó, ni ser negativo.',
  NOTE_REQUIRED: 'Explicá en una línea por qué se anula: queda en el historial.',
  FORBIDDEN: 'Solo contabilidad o administración pueden anular pagos.',
  PERIODO_CERRADO: 'El pago es de una gestión ya cerrada: reabrila antes de anular.',
};

export default function AnularPagoDialog({
  pago,
  onClose,
  onDone,
}: {
  pago: PagoAnulable | null;
  onClose: () => void;
  /** Recargar la pantalla que lo abrió: el pago ya no suma. */
  onDone: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const { cuentas } = useTesoreria();

  const [modo, setModo] = useState<'devolucion' | 'error'>('devolucion');
  const [nota, setNota] = useState('');
  const [monto, setMonto] = useState('');
  const [cuentaId, setCuentaId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!pago) return null;

  // El monto arranca en el total y se edita: la devolución parcial es el caso
  // que pidió el dueño («the amount be editable in case it is custom»).
  const devuelto = monto === '' ? pago.monto_bob : Number(monto.replace(',', '.'));
  const retenido = Math.round((pago.monto_bob - (Number.isFinite(devuelto) ? devuelto : 0)) * 100) / 100;

  const guardar = async () => {
    if (!nota.trim()) {
      setError('Explicá en una línea por qué se anula: queda en el historial.');
      return;
    }
    if (modo === 'devolucion' && (!Number.isFinite(devuelto) || devuelto < 0 || devuelto > pago.monto_bob)) {
      setError(`Lo devuelto va de 0 a ${formatMoney(pago.monto_bob, 'BOB')}, que fue lo que pagó.`);
      return;
    }
    setSaving(true);
    setError(null);
    const { error: e } = await supabase.rpc('admin_anular_pago', {
      p_payment_id: pago.payment_id,
      p_nota: nota.trim(),
      p_modo: modo,
      p_monto_devuelto: modo === 'devolucion' ? devuelto : null,
      p_treasury_devolucion: modo === 'devolucion' && cuentaId ? cuentaId : null,
    });
    setSaving(false);
    if (e) {
      setError(COPY_EXTRA[e.message] ?? adminErrorCopy(e.message));
      return;
    }
    push('Pago anulado. La deuda y las cuotas ya están recalculadas.');
    onDone();
    onClose();
  };

  return (
    <Dialog open onClose={onClose} title="Anular este pago">
      <div className="space-y-4">
        <p className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">
          {pago.etiqueta} — {formatMoney(pago.monto_bob, 'BOB')}
        </p>

        {/* Qué pasó con la plata: decide el asiento. */}
        <div className="space-y-2">
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-stone-200 p-3 text-sm">
            <input
              type="radio"
              name="modo-anulacion"
              checked={modo === 'devolucion'}
              onChange={() => setModo('devolucion')}
              className="mt-0.5"
            />
            <span>
              <span className="font-semibold text-stone-900">La plata entró y se anula el cobro</span>
              <span className="mt-0.5 block text-xs text-stone-500">
                Se devuelve todo, parte o nada — el monto se edita abajo. Lo no devuelto queda
                como ingreso y el comprobante de ajuste se emite solo.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-stone-200 p-3 text-sm">
            <input
              type="radio"
              name="modo-anulacion"
              checked={modo === 'error'}
              onChange={() => setModo('error')}
              className="mt-0.5"
            />
            <span>
              <span className="font-semibold text-stone-900">Error de registro: la plata nunca entró</span>
              <span className="mt-0.5 block text-xs text-stone-500">
                Se cargó dos veces o a la venta equivocada. El pago se cancela sin más asiento.
              </span>
            </span>
          </label>
        </div>

        {modo === 'devolucion' ? (
          <>
            <div>
              <label className="mb-1 block text-xs font-semibold text-stone-600">
                Monto a devolver (Bs)
              </label>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={pago.monto_bob}
                step="0.01"
                value={monto === '' ? pago.monto_bob : monto}
                onChange={(e) => setMonto(e.target.value)}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-stone-500">
                {retenido > 0
                  ? `Se retienen ${formatMoney(retenido, 'BOB')}: quedan como ingreso por anulación.`
                  : 'Se devuelve el pago completo.'}
              </p>
            </div>
            {cuentas.length > 0 ? (
              <CuentaSelect
                cuentas={cuentas}
                value={cuentaId}
                onChange={setCuentaId}
                label="De qué caja o banco sale la devolución"
                monto={Number.isFinite(devuelto) ? devuelto : 0}
                signo={-1}
              />
            ) : null}
          </>
        ) : null}

        <div>
          <label className="mb-1 block text-xs font-semibold text-stone-600">Motivo</label>
          <textarea
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            rows={2}
            placeholder="Por qué se anula: queda en el historial del lote."
            className={inputClass}
          />
        </div>

        {error ? <p className="text-sm text-red-700">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancelar
          </button>
          <button type="button" onClick={guardar} disabled={saving} className={btnPrimary}>
            {saving ? 'Anulando…' : 'Anular pago'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
