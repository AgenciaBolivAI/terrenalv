'use client';

// El diálogo con el que la oficina cobra: cuota si hay plan, abono si no,
// en bolivianos o en dólares al cambio del día, y con el recibo listo al
// terminar (imprimir o WhatsApp), porque el comprador está en el mostrador
// esperándolo.
//
// Vive en su propio archivo porque cobra desde DOS pantallas — Contabilidad
// (Por cobrar) y Ventas (el detalle de cada venta) — y dos copias divergirían:
// una se quedaría sin moneda o sin recibo la próxima vez que se toque la otra.

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatMoney, waLink } from '@/lib/format';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';
import { btnPrimary, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { Dialog } from '@/features/admin/ui/dialog';
import { useToast } from '@/features/admin/ui/toast';
import { CuentaSelect, useTesoreria } from './Tesoreria';
import type { CobroTarget } from './types';

export default function RegistrarCobroDialog({
  cobro,
  onClose,
  onPaid,
}: {
  cobro: CobroTarget;
  onClose: () => void;
  onPaid: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const [amount, setAmount] = useState(
    cobro.monto_sugerido != null ? String(cobro.monto_sugerido) : '',
  );
  // En qué moneda entró la plata. El negocio es en bolivianos, pero en el
  // mostrador aparecen dólares — y el cambio real del día no siempre es el
  // configurado, así que se prellena y se deja corregir.
  const [moneda, setMoneda] = useState<'BOB' | 'USD'>('BOB');
  const [cambio, setCambio] = useState('');

  useEffect(() => {
    let vivo = true;
    void supabase
      .rpc('get_exchange_rate', { p_project_id: cobro.project_id })
      .then(({ data }) => {
        if (vivo && data != null) setCambio(String(data));
      });
    return () => {
      vivo = false;
    };
  }, [supabase, cobro.project_id]);
  // El pago quedó registrado: ahora lo que hace falta es el RECIBO, porque el
  // comprador está parado en el mostrador esperándolo. Por eso el diálogo no se
  // cierra solo: muestra el enlace de imprimir y el de WhatsApp.
  const [hecho, setHecho] = useState<{ paymentId: string; tipo: string } | null>(null);
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [provider, setProvider] = useState<'efectivo' | 'manual_qr' | 'banco_ganadero' | 'bnb'>('efectivo');
  const [reference, setReference] = useState('');
  // A qué cuenta entró el cobro: sin esto el asiento cae en la 1111 genérica y
  // el saldo del banco en el sistema deja de coincidir con el extracto.
  const { cuentas } = useTesoreria();
  const [cuentaId, setCuentaId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function register() {
    setError(null);
    const a = Number(amount);
    if (!(a > 0)) {
      setError('El monto debe ser mayor a cero.');
      return;
    }
    const tc = Number(cambio);
    if (moneda === 'USD' && !(tc >= 1 && tc <= 100)) {
      setError('Revisa el tipo de cambio: tiene que ser Bs por $us (ej. 6.96).');
      return;
    }
    setBusy(true);
    const { data, error: err } = await supabase.rpc('admin_register_cuota_payment', {
      p_reservation_id: cobro.reservation_id,
      p_amount: a,
      p_paid_on: paidOn,
      p_provider: provider,
      p_reference: reference.trim() || null,
      p_note: note.trim() || null,
      p_treasury_account_id: cuentaId || null,
      p_currency: moneda,
      p_exchange_rate: moneda === 'USD' ? tc : null,
    });
    setBusy(false);
    if (err) {
      setError(adminErrorCopy(err.message));
      return;
    }
    const r = data as {
      payment_id?: string;
      tipo?: string;
      aplicado?: number;
      sobrante?: number;
      cuotas_afectadas?: number;
    } | null;
    if (r?.tipo === 'abono') {
      push('Abono registrado.', 'success');
    } else {
      const extra =
        Number(r?.sobrante ?? 0) > 0
          ? ` Sobran ${formatMoney(Number(r?.sobrante), cobro.currency)} sin aplicar: el plan ya no tiene cuotas pendientes.`
          : '';
      push(`Pago registrado en ${r?.cuotas_afectadas ?? 0} cuota(s).${extra}`, 'success');
    }
    if (r?.payment_id) {
      setHecho({ paymentId: r.payment_id, tipo: r?.tipo ?? 'cuota' });
      onPaid();
    } else {
      onPaid();
      onClose();
    }
  }

  if (hecho) {
    const enlace = `/reserva/${cobro.tracking_code}/recibo/${hecho.paymentId}`;
    return (
      <Dialog open onClose={onClose} title="Pago registrado">
        <div className="space-y-3">
          <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800">
            {hecho.tipo === 'abono' ? 'Abono' : 'Pago'} de{' '}
            <strong>{formatMoney(Number(amount), moneda)}</strong>
            {moneda === 'USD'
              ? ` (${formatMoney(Math.round(Number(amount) * Number(cambio) * 100) / 100, 'BOB')} al cambio ${cambio})`
              : ''}{' '}
            registrado a {cobro.buyer_full_name}.
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={`/admin/recibo/${hecho.paymentId}`}
              target="_blank"
              rel="noreferrer"
              className={btnSecondary}
            >
              Ver / imprimir recibo
            </a>
            <a
              href={waLink(
                cobro.buyer_phone,
                `Hola ${cobro.buyer_full_name}, aquí está el recibo de tu ${
                  hecho.tipo === 'abono' ? 'abono' : 'pago'
                } de ${formatMoney(Number(amount), cobro.currency)}: ${
                  typeof window === 'undefined' ? '' : window.location.origin
                }${enlace}`,
              )}
              target="_blank"
              rel="noreferrer"
              className={btnPrimary}
            >
              Enviar por WhatsApp
            </a>
          </div>
          <p className="text-[11px] text-stone-500">
            El enlace abre el recibo con el código de la reserva: el comprador lo ve sin cuenta, y
            solo el suyo.
          </p>
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" className={btnSecondary} onClick={onClose}>
            Listo
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`${cobro.tiene_plan ? 'Registrar pago' : 'Registrar abono'} — ${cobro.buyer_full_name}`}
    >
      <div className="space-y-3">
        <p className="rounded-lg bg-stone-50 p-3 text-sm text-stone-600">
          Saldo actual <strong>{formatMoney(cobro.saldo, cobro.currency)}</strong>.{' '}
          {cobro.tiene_plan
            ? 'El pago se aplica desde la cuota más vieja hacia adelante.'
            : 'Esta venta no tiene plan de cuotas: el pago entra como abono y baja el saldo.'}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Monto</label>
            <div className="flex gap-1.5">
              <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
              <select
                value={moneda}
                onChange={(e) => setMoneda(e.target.value as 'BOB' | 'USD')}
                className={`${inputClass} w-auto`}
                title="En qué moneda entró la plata"
              >
                <option value="BOB">Bs</option>
                <option value="USD">$us</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">Fecha</label>
            <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className={inputClass} />
          </div>
          {moneda === 'USD' ? (
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-stone-500">
                Tipo de cambio del día (Bs por $us)
              </label>
              <input
                type="number"
                min={1}
                step="0.01"
                value={cambio}
                onChange={(e) => setCambio(e.target.value)}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-stone-500">
                Prellenado con el configurado — corregilo al del día si difiere.
                {Number(amount) > 0 && Number(cambio) > 0 ? (
                  <>
                    {' '}
                    Se asientan{' '}
                    <strong className="tabular-nums">
                      {formatMoney(Math.round(Number(amount) * Number(cambio) * 100) / 100, 'BOB')}
                    </strong>
                    .
                  </>
                ) : null}
              </p>
            </div>
          ) : null}
          <div>
            <label className="mb-1 block text-xs text-stone-500">Forma de pago</label>
            <select value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)} className={inputClass}>
              <option value="efectivo">Efectivo</option>
              <option value="manual_qr">QR / transferencia</option>
              <option value="banco_ganadero">Banco Ganadero</option>
              <option value="bnb">BNB</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">Referencia (opcional)</label>
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="N° de comprobante" className={inputClass} />
          </div>
        </div>
        <CuentaSelect
          cuentas={cuentas}
          value={cuentaId}
          onChange={setCuentaId}
          label="Depositado en"
          monto={Number(amount)}
          signo={1}
        />
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Nota (opcional)" className={inputClass} />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Volver
        </button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void register()}>
          {busy ? 'Registrando…' : 'Registrar pago'}
        </button>
      </div>
    </Dialog>
  );
}
