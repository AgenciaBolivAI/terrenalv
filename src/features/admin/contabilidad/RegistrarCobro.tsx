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
  // Con plan, pagar una cuota y ABONAR A CAPITAL son cosas distintas: la
  // cuota imputa al cronograma; el abono a capital baja la deuda y rearma lo
  // que falta — menos meses, o cuota más baja. La cajera elige.
  const [destino, setDestino] = useState<'cuota' | 'capital'>('cuota');
  const [recalculo, setRecalculo] = useState<'plazo' | 'cuota'>('plazo');
  // El cronograma vivo: sin esto el diálogo no puede DECIR qué va a pasar, y
  // la cajera elige entre dos cosas muy distintas a ciegas.
  const [plan, setPlan] = useState<{
    cuota: number;
    pendientes: { numero: number; vence: string; falta: number }[];
  } | null>(null);

  useEffect(() => {
    if (!cobro.tiene_plan) return;
    let vivo = true;
    void (async () => {
      const { data: pl } = await supabase
        .from('installment_plans')
        .select('id, monthly_amount')
        .eq('reservation_id', cobro.reservation_id)
        .eq('status', 'activo')
        .maybeSingle();
      if (!vivo || !pl) return;
      const { data: cs } = await supabase
        .from('installments')
        .select('number, due_date, amount, amount_paid, status')
        .eq('plan_id', (pl as { id: string }).id)
        .in('status', ['pendiente', 'parcial'])
        .order('number');
      if (!vivo) return;
      setPlan({
        cuota: Number((pl as { monthly_amount: number }).monthly_amount),
        pendientes: (cs ?? []).map((c) => {
          const r = c as { number: number; due_date: string; amount: number; amount_paid: number };
          return {
            numero: Number(r.number),
            vence: r.due_date,
            falta: Number(r.amount) - Number(r.amount_paid),
          };
        }),
      });
    })();
    return () => {
      vivo = false;
    };
  }, [supabase, cobro.reservation_id, cobro.tiene_plan]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Qué va a pasar con este pago, en plata y en meses. Replica exactamente lo
  // que hace admin_register_cuota_payment: si el diálogo prometiera otra cosa
  // que la base, sería peor que no prometer nada.
  const efecto = useMemo(() => {
    const bruto = Number(amount) || 0;
    if (bruto <= 0) return null;
    const bs = moneda === 'USD' ? Math.round(bruto * (Number(cambio) || 0) * 100) / 100 : bruto;
    if (bs <= 0) return null;

    const saldoAntes = Number(cobro.saldo);
    const saldoDespues = Math.max(0, Math.round((saldoAntes - bs) * 100) / 100);
    const excede = bs > saldoAntes + 0.01;

    if (!cobro.tiene_plan || !plan) {
      return { bs, saldoAntes, saldoDespues, excede, modo: 'abono' as const };
    }

    const pendienteAntes =
      Math.round(plan.pendientes.reduce((t, c) => t + c.falta, 0) * 100) / 100;

    if (destino === 'cuota') {
      // Cascada desde la cuota más vieja, igual que la base.
      let resto = bs;
      const cubiertas: number[] = [];
      let parcial: { numero: number; queda: number } | null = null;
      for (const c of plan.pendientes) {
        if (resto <= 0) break;
        if (resto >= c.falta - 0.01) {
          cubiertas.push(c.numero);
          resto = Math.round((resto - c.falta) * 100) / 100;
        } else {
          parcial = { numero: c.numero, queda: Math.round((c.falta - resto) * 100) / 100 };
          resto = 0;
        }
      }
      const quedan = plan.pendientes.length - cubiertas.length;
      const proxima = plan.pendientes.find((c) => !cubiertas.includes(c.numero)) ?? null;
      return {
        bs,
        saldoAntes,
        saldoDespues,
        excede,
        modo: 'cuota' as const,
        cubiertas,
        parcial,
        quedan,
        proxima,
        cuota: plan.cuota,
        sobra: resto > 0.01 ? resto : 0,
      };
    }

    // Abono a capital: baja la deuda y rearma lo que falta.
    const pendienteDespues = Math.round((pendienteAntes - bs) * 100) / 100;
    if (pendienteDespues <= 0.01) {
      return { bs, saldoAntes, saldoDespues, excede, modo: 'capital' as const, cancela: true };
    }
    const hoy = new Date().toISOString().slice(0, 10);
    const futuras = plan.pendientes.filter((c) => c.vence >= hoy).length || 1;
    const mesesAntes = plan.pendientes.length;
    if (recalculo === 'plazo') {
      const meses = Math.max(1, Math.ceil(pendienteDespues / plan.cuota));
      return {
        bs,
        saldoAntes,
        saldoDespues,
        excede,
        modo: 'capital' as const,
        cancela: false,
        recalc: 'plazo' as const,
        mesesAntes,
        mesesDespues: meses,
        cuotaAntes: plan.cuota,
        cuotaDespues: plan.cuota,
        pendienteAntes,
        pendienteDespues,
      };
    }
    const nueva = Math.ceil((pendienteDespues / futuras) * 100) / 100;
    return {
      bs,
      saldoAntes,
      saldoDespues,
      excede,
      modo: 'capital' as const,
      cancela: false,
      recalc: 'cuota' as const,
      mesesAntes,
      mesesDespues: futuras,
      cuotaAntes: plan.cuota,
      cuotaDespues: nueva,
      pendienteAntes,
      pendienteDespues,
    };
  }, [amount, moneda, cambio, cobro.saldo, cobro.tiene_plan, plan, destino, recalculo]);

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
      p_destino: cobro.tiene_plan ? destino : null,
      p_recalculo: cobro.tiene_plan && destino === 'capital' ? recalculo : null,
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
      plan_recalculado?: { modo?: string; meses?: number; cuota?: number } | null;
    } | null;
    const rec = r?.plan_recalculado as
      | { modo?: string; meses?: number; cuota?: number }
      | null
      | undefined;
    if (rec) {
      push(
        rec.modo === 'cancelado'
          ? '¡Abono a capital! El plan quedó cancelado: no queda saldo.'
          : `Abono a capital: quedan ${rec.meses} cuotas de ${formatMoney(Number(rec.cuota), 'BOB')}.`,
        'success',
      );
    } else if (r?.tipo === 'abono') {
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
            ? 'Elegí abajo si este pago va a las cuotas o al capital.'
            : 'Esta venta no tiene plan de cuotas: el pago entra como abono y baja el saldo.'}
        </p>
        {cobro.tiene_plan ? (
          <div className="space-y-2 rounded-lg border border-stone-200 p-3">
            <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
              ¿Qué está pagando?
            </p>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="radio"
                checked={destino === 'cuota'}
                onChange={() => setDestino('cuota')}
                className="mt-1"
              />
              <span>
                <strong>Su cuota del mes</strong>
                <span className="block text-xs text-stone-500">
                  El pago normal del plan: cubre las cuotas vencidas y las que siguen. La cuota
                  mensual queda igual.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="radio"
                checked={destino === 'capital'}
                onChange={() => setDestino('capital')}
                className="mt-1"
              />
              <span>
                <strong>Abono a capital (amortizar)</strong>
                <span className="block text-xs text-stone-500">
                  Plata EXTRA además de su cuota: baja la deuda y el plan se rearma.
                </span>
              </span>
            </label>
            {destino === 'capital' ? (
              <div className="ml-6 space-y-1.5 border-l-2 border-stone-200 pl-3">
                <p className="text-[11px] text-stone-500">
                  Adelantar capital baja la deuda hoy; el comprador elige cómo aprovecharlo:
                </p>
                <p className="text-xs font-semibold text-stone-600">Con el abono, el comprador:</p>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={recalculo === 'plazo'}
                    onChange={() => setRecalculo('plazo')}
                  />
                  <span>Termina antes — misma cuota, menos meses</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={recalculo === 'cuota'}
                    onChange={() => setRecalculo('cuota')}
                  />
                  <span>Paga menos por mes — mismo plazo, cuota más baja</span>
                </label>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* EL EFECTO, en plata: qué pasa con el saldo y con el cronograma si
            se registra este cobro tal como está. Sin esto la cajera elige
            entre «cuota» y «capital» sin ver la diferencia. */}
        {efecto ? (
          <div
            className={`rounded-lg border p-3 text-sm ${
              efecto.excede
                ? 'border-red-200 bg-red-50 text-red-800'
                : 'border-brand/30 bg-green-50/60 text-stone-700'
            }`}
          >
            {efecto.excede ? (
              <p>
                <strong>Este cobro supera el saldo.</strong> El saldo es{' '}
                {formatMoney(efecto.saldoAntes, 'BOB')} y estás cobrando{' '}
                {formatMoney(efecto.bs, 'BOB')}. Bajá el monto: el sistema no acepta cobrar de más.
              </p>
            ) : (
              <>
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-xs text-stone-500">Saldo del lote</span>
                  <strong className="tabular-nums">{formatMoney(efecto.saldoAntes, 'BOB')}</strong>
                  <span className="text-stone-400">→</span>
                  <strong className="text-base tabular-nums text-brand">
                    {formatMoney(efecto.saldoDespues, 'BOB')}
                  </strong>
                  {moneda === 'USD' ? (
                    <span className="text-xs text-stone-500">
                      (entran {formatMoney(efecto.bs, 'BOB')})
                    </span>
                  ) : null}
                </p>

                {efecto.modo === 'abono' ? (
                  <p className="mt-1 text-xs text-stone-600">
                    Abono libre: no hay cronograma que tocar, solo baja el saldo.
                  </p>
                ) : null}

                {efecto.modo === 'cuota' ? (
                  <p className="mt-1 text-xs text-stone-600">
                    {efecto.cubiertas && efecto.cubiertas.length > 0
                      ? `Paga ${efecto.cubiertas.length} cuota(s) completa(s) (N° ${efecto.cubiertas.join(', N° ')}). `
                      : ''}
                    {efecto.parcial
                      ? `Deja la cuota N° ${efecto.parcial.numero} a medias: le faltarían ${formatMoney(efecto.parcial.queda, 'BOB')}. `
                      : ''}
                    {efecto.quedan !== undefined
                      ? `Quedan ${efecto.quedan} cuota(s) de ${formatMoney(Number(efecto.cuota), 'BOB')}`
                      : ''}
                    {efecto.proxima ? `, la próxima vence ${efecto.proxima.vence}` : ''}.
                    {efecto.sobra && efecto.sobra > 0
                      ? ` Sobran ${formatMoney(efecto.sobra, 'BOB')} sin aplicar: el plan ya no tiene más cuotas.`
                      : ''}{' '}
                    <span className="text-stone-500">
                      La cuota mensual NO cambia: este pago es el del mes, no adelanta capital.
                    </span>
                  </p>
                ) : null}

                {efecto.modo === 'capital' && efecto.cancela ? (
                  <p className="mt-1 text-xs font-semibold text-brand">
                    Con este abono el plan queda CANCELADO: no le queda ninguna cuota.
                  </p>
                ) : null}

                {efecto.modo === 'capital' && !efecto.cancela ? (
                  <div className="mt-1.5 space-y-1 text-xs text-stone-600">
                    <p>
                      Deuda del plan{' '}
                      <strong className="tabular-nums">
                        {formatMoney(Number(efecto.pendienteAntes), 'BOB')}
                      </strong>{' '}
                      → <strong className="tabular-nums">
                        {formatMoney(Number(efecto.pendienteDespues), 'BOB')}
                      </strong>
                    </p>
                    {efecto.recalc === 'plazo' ? (
                      <p>
                        Sigue pagando{' '}
                        <strong>{formatMoney(Number(efecto.cuotaDespues), 'BOB')}</strong> al mes,
                        pero le quedan{' '}
                        <strong>{efecto.mesesDespues} cuota(s)</strong> en vez de{' '}
                        {efecto.mesesAntes}:{' '}
                        <strong className="text-brand">
                          termina {Number(efecto.mesesAntes) - Number(efecto.mesesDespues)} mes(es)
                          antes
                        </strong>
                        .
                      </p>
                    ) : (
                      <p>
                        Mantiene sus <strong>{efecto.mesesDespues} cuota(s)</strong>, pero la cuota
                        baja de {formatMoney(Number(efecto.cuotaAntes), 'BOB')} a{' '}
                        <strong className="text-brand">
                          {formatMoney(Number(efecto.cuotaDespues), 'BOB')}
                        </strong>{' '}
                        al mes.
                      </p>
                    )}
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
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
