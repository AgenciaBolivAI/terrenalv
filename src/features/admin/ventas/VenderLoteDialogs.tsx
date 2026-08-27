'use client';

// Vender y reservar un lote desde el mostrador.
//
// Viven acá y no dentro de la pantalla de Lotes porque el mostrador entra por
// TRES puertas: el listado de lotes, la pantalla de Ventas y la de Reservas.
// Una copia por pantalla es como terminan diciendo cosas distintas — ya pasó
// con las etiquetas y con la fórmula de la cuota.

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { cuotaDelPlan, anualDesdeMensual, mensualDesdeAnual } from '@/lib/financing';
import { formatMoney } from '@/lib/format';
import { ciSchema, phoneSchema } from '@/lib/validation';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';
import { btnPrimary, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { Dialog } from '@/features/admin/ui/dialog';
import { useToast } from '@/features/admin/ui/toast';
import { CuentaSelect, useTesoreria } from '@/features/admin/contabilidad/Tesoreria';

/**
 * El equipo activo, para elegir quién vendió.
 *
 * La comisión se le paga a una persona, así que la venta tiene que saber de
 * quién es. Preguntarlo DESPUÉS no funciona: a las tres semanas nadie se
 * acuerda quién cerró qué, y la comisión se discute de memoria.
 */
function useEquipo() {
  const supabase = useMemo(() => createClient(), []);
  const [equipo, setEquipo] = useState<{ id: string; full_name: string; rol: string }[]>([]);
  const [yo, setYo] = useState<string>('');

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const [{ data }, { data: sesion }] = await Promise.all([
        supabase.from('v_equipo_activo').select('id, full_name, rol').order('full_name'),
        supabase.auth.getUser(),
      ]);
      if (!vivo) return;
      setEquipo((data ?? []) as { id: string; full_name: string; rol: string }[]);
      // Por defecto, quien está usando el panel: es quien está atendiendo.
      if (sesion?.user?.id) setYo(sesion.user.id);
    })();
    return () => {
      vivo = false;
    };
  }, [supabase]);

  return { equipo, yo };
}

function VendedorSelect({
  equipo,
  value,
  onChange,
  label = 'Vendedor (quién cierra la venta)',
}: {
  equipo: { id: string; full_name: string; rol: string }[];
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-stone-500">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        <option value="">Sin vendedor asignado</option>
        {equipo.map((m) => (
          <option key={m.id} value={m.id}>
            {m.full_name} · {m.rol}
          </option>
        ))}
      </select>
      <p className="mt-1 text-[11px] text-stone-400">
        De quién es la comisión. Se puede corregir después desde Ventas.
      </p>
    </div>
  );
}

/** Lo mínimo que los diálogos necesitan saber del lote. */
export interface LoteParaVender {
  id: string;
  project_id: string;
  number: string;
}

export function SellOfflineDialog({
  lot,
  mzCode,
  defaultPrice,
  currency,
  onClose,
  onSold,
}: {
  lot: LoteParaVender;
  mzCode: string;
  defaultPrice: number | null;
  currency: 'USD' | 'BOB';
  onClose: () => void;
  onSold: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const [name, setName] = useState('');
  const [ci, setCi] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [amount, setAmount] = useState(defaultPrice != null ? String(defaultPrice) : '');
  const [note, setNote] = useState('');
  // Cómo pagó: antes iba 'manual_qr' escrito a mano en la base, y este flujo
  // crea el pago YA APROBADO — entraba al libro con la vía equivocada sin que
  // nadie lo revisara.
  const [forma, setForma] = useState<'efectivo' | 'manual_qr' | 'banco_ganadero' | 'bnb'>(
    'efectivo',
  );
  // La clasificacion de la venta desde el arranque: contado o credito, en que
  // moneda entro la plata y a que cuenta — lo mismo que pregunta el cobro.
  const [modalidad, setModalidad] = useState<'contado' | 'credito'>('contado');
  // ¿La cajera tecleó el monto a mano? Entonces no se lo pisamos nunca más.
  const [montoTocado, setMontoTocado] = useState(false);
  const { equipo, yo } = useEquipo();
  const [vendedor, setVendedor] = useState('');
  useEffect(() => {
    if (yo && !vendedor) setVendedor(yo);
  }, [yo, vendedor]);
  const [moneda, setMoneda] = useState<'BOB' | 'USD'>('BOB');
  const [cambio, setCambio] = useState('');
  const [precio, setPrecio] = useState(defaultPrice != null ? String(defaultPrice) : '');
  const { cuentas } = useTesoreria();
  const [cuentaId, setCuentaId] = useState('');
  // El plan de pago se decide ACA, en el mostrador: plazo, cuota y primer
  // vencimiento. Antes la venta a credito nacia sin cronograma y habia que ir
  // a Contabilidad a crearlo — y si nadie iba, la cobranza no existia.
  const [conPlan, setConPlan] = useState(true);
  const [meses, setMeses] = useState('12');
  const [cuota, setCuota] = useState('');
  // Las condiciones que le tocan a ESTE lote por su precio: cuánta inicial se
  // exige, cuánto interés se cobra y hasta cuántos meses. Se traen de la
  // clasificación para que nadie las invente en el mostrador.
  const [cond, setCond] = useState<{
    nombre: string;
    inicial_pct: number;
    inicial_sugerida: number;
    interes_mensual_pct: number;
    max_meses: number;
  } | null>(null);
  // Lo que TIPEA el vendedor es la tasa ANUAL; la mensual la calcula el
  // sistema. Antes el campo pedía la mensual y alguien que escribiera «20»
  // pensando en el año pactaba 20 % POR MES — 240 % anual.
  const [interesAnual, setInteresAnual] = useState('0');
  const interes = String(mensualDesdeAnual(Number(interesAnual) || 0));
  const [primerVenc, setPrimerVenc] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  });
  useEffect(() => {
    let vivo = true;
    void supabase.rpc('get_exchange_rate', { p_project_id: lot.project_id }).then(({ data }) => {
      if (vivo && data != null) setCambio(String(data));
    });
    return () => {
      vivo = false;
    };
  }, [supabase, lot.project_id]);

  // El precio manda: al cambiarlo puede cambiar la clasificación del lote.
  const precioEfectivo = precio.trim() === '' ? (defaultPrice ?? 0) : Number(precio);

  // AL CONTADO se cobra el lote entero; A CRÉDITO se cobra la cuota inicial de
  // su clasificación. Antes el campo se quedaba con el precio completo al
  // pasar a crédito, así que «queda por financiar» daba Bs 0 y no había cuota
  // que calcular — el formulario se contradecía solo.
  useEffect(() => {
    if (montoTocado) return;
    if (modalidad === 'contado') {
      setAmount(defaultPrice != null ? String(defaultPrice) : '');
    } else if (cond) {
      setAmount(String(cond.inicial_sugerida));
    }
  }, [modalidad, cond, defaultPrice, montoTocado]);

  /**
   * El plan que saldría con lo tecleado ahora mismo: cuánto se financia, la
   * cuota, cuánto interés y el total. La MISMA cuenta que hace la base
   * (sistema francés si hay interés), calculada acá para que el formulario
   * muestre la cifra en vez de prometer que ya la calculará alguien.
   */
  const plan = useMemo(() => {
    const inicialBs = (Number(amount) || 0) * (moneda === 'USD' ? Number(cambio) || 0 : 1);
    const financiar = Math.max(0, (precioEfectivo || 0) - inicialBs);
    const m = Number(meses) || 0;
    // La fórmula vive en un solo lugar (src/lib/financing) y está probada
    // contra las cifras que devuelve la base.
    const c = cuotaDelPlan(financiar, Number(interes) || 0, m);
    const total = Math.round(c * m * 100) / 100;
    return { inicialBs, financiar, meses: m, cuota: c, total, interesTotal: Math.round((total - financiar) * 100) / 100 };
  }, [amount, moneda, cambio, precioEfectivo, meses, interes]);
  void interesAnual;
  useEffect(() => {
    let vivo = true;
    void supabase
      .rpc('condiciones_financiamiento', {
        p_project_id: lot.project_id,
        p_price: precioEfectivo || 0,
      })
      .then(({ data }) => {
        if (!vivo) return;
        const c = data as {
          nombre: string;
          inicial_pct: number;
          inicial_sugerida: number;
          interes_mensual_pct: number;
          max_meses: number;
        } | null;
        setCond(c);
        // La condición del lote viene en mensual; el campo habla en anual.
        if (c) setInteresAnual(String(anualDesdeMensual(Number(c.interes_mensual_pct) || 0)));
      });
    return () => {
      vivo = false;
    };
  }, [supabase, lot.project_id, precioEfectivo]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sell() {
    setError(null);
    if (name.trim().length < 5) {
      setError('Escribe el nombre completo del comprador.');
      return;
    }
    const ciCheck = ciSchema.safeParse(ci);
    if (!ciCheck.success) {
      setError('Carnet inválido (ej: 7896541 o 7896541-1E).');
      return;
    }
    const phoneCheck = phoneSchema.safeParse(phone);
    if (!phoneCheck.success) {
      setError('Celular boliviano inválido (8 dígitos, empieza con 6 o 7).');
      return;
    }
    const monto = amount.trim() === '' ? null : Number(amount);
    if (monto !== null && (Number.isNaN(monto) || monto < 0)) {
      setError('Monto inválido.');
      return;
    }
    const precioNum = precio.trim() === '' ? null : Number(precio);
    if (precioNum !== null && !(precioNum > 0)) {
      setError('El precio pactado debe ser mayor a cero.');
      return;
    }
    const tc = Number(cambio);
    if (moneda === 'USD' && !(tc >= 1 && tc <= 100)) {
      setError('Revisa el tipo de cambio: Bs por $us (ej. 6.96).');
      return;
    }
    const llevaPlan = modalidad === 'credito' && conPlan;
    const mesesNum = Number(meses);
    const cuotaNum = Number(cuota);
    if (llevaPlan) {
      if (!(mesesNum >= 1 && mesesNum <= 480)) {
        setError('El plazo va de 1 a 480 meses.');
        return;
      }
      if (!(Number(interes) > 0) && !(cuotaNum > 0)) {
        setError('Escribe la cuota mensual, o poné un interés y se calcula sola.');
        return;
      }
      if (Number(interes) > 0 && !(plan.cuota > 0)) {
        setError('Revisá el precio, la inicial y el plazo: no queda nada que financiar.');
        return;
      }
      if (cond && mesesNum > cond.max_meses) {
        setError(
          `${cond.nombre} admite hasta ${cond.max_meses} meses. Cambiá el plazo o la clasificación.`,
        );
        return;
      }
    }
    setBusy(true);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setError('Escribe el correo del comprador: por ahí le llega su venta y sus recibos.');
      return;
    }

    const { data, error: err } = await supabase.rpc('mark_sold_offline', {
      p_lot_id: lot.id,
      p_full_name: name.trim(),
      p_ci: ci.trim(),
      p_phone: phone.trim(),
      p_email: email.trim(),
      p_provider: forma,
      p_amount: monto,
      p_note: note.trim() || null,
      p_modalidad: modalidad,
      p_currency: moneda,
      p_exchange_rate: moneda === 'USD' ? tc : null,
      p_treasury_account_id: cuentaId || null,
      p_price: precioNum,
      p_plan_months: llevaPlan ? mesesNum : null,
      p_plan_monthly: llevaPlan ? cuotaNum : null,
      p_plan_first_due: llevaPlan ? primerVenc : null,
      p_plan_interes_mensual: llevaPlan ? Number(interes) || 0 : null,
      p_sold_by: vendedor || null,
    });
    setBusy(false);
    if (err) {
      setError(adminErrorCopy(err.message));
      return;
    }
    const r = data as { tracking_code?: string; plan_id?: string | null } | null;
    push(
      `Lote vendido en oficina${r?.tracking_code ? ` — código ${r.tracking_code}` : ''}${
        r?.plan_id ? ` · plan de ${mesesNum} cuotas creado` : ''
      }.`,
      'success',
    );
    onSold();
  }


  return (
    <Dialog open onClose={onClose} title={`Vender en oficina — Mz ${mzCode}, Lote ${lot.number}`}>
      <div className="space-y-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre completo" className={inputClass} />
        <div className="grid grid-cols-2 gap-3">
          <input value={ci} onChange={(e) => setCi(e.target.value)} placeholder="Carnet (CI)" className={inputClass} />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Celular" inputMode="tel" className={inputClass} />
        </div>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Correo del comprador" inputMode="email" className={inputClass} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Modalidad</label>
            <select
              value={modalidad}
              onChange={(e) => setModalidad(e.target.value as typeof modalidad)}
              className={inputClass}
            >
              <option value="contado">Contado — paga el lote entero</option>
              <option value="credito">Crédito — entrega cuota inicial</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">Moneda del pago</label>
            <select
              value={moneda}
              onChange={(e) => setMoneda(e.target.value as typeof moneda)}
              className={inputClass}
            >
              <option value="BOB">Bolivianos (Bs)</option>
              <option value="USD">Dólares ($us)</option>
            </select>
          </div>
        </div>
        {moneda === 'USD' ? (
          <div>
            <label className="mb-1 block text-xs text-stone-500">Tipo de cambio del día (Bs por $us)</label>
            <input
              type="number"
              min={1}
              step="0.01"
              value={cambio}
              onChange={(e) => setCambio(e.target.value)}
              className={inputClass}
            />
          </div>
        ) : null}
        <div>
          <label className="mb-1 block text-xs text-stone-500">
            Precio pactado (Bs) — vacío usa el de lista
          </label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            className={inputClass}
          />
        </div>
        <VendedorSelect equipo={equipo} value={vendedor} onChange={setVendedor} />
        <div>
          <label className="mb-1 block text-xs text-stone-500">Forma de pago</label>
          <select
            value={forma}
            onChange={(e) => setForma(e.target.value as typeof forma)}
            className={inputClass}
          >
            <option value="efectivo">Efectivo</option>
            <option value="manual_qr">QR / transferencia</option>
            <option value="banco_ganadero">Banco Ganadero</option>
            <option value="bnb">BNB</option>
          </select>
          <p className="mt-1 text-[11px] text-stone-400">
            Queda registrada desde el arranque: el efectivo hay que arquearlo, el QR tiene que
            aparecer en el extracto.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs text-stone-500">
            {modalidad === 'contado'
              ? `Monto cobrado (${moneda === 'BOB' ? 'Bs' : '$us'}) — vacío usa el precio`
              : `Cuota inicial cobrada (${moneda === 'BOB' ? 'Bs' : '$us'})`}
          </label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => {
              setMontoTocado(true);
              setAmount(e.target.value);
            }}
            className={inputClass}
          />
          {modalidad === 'credito' ? (
            <p className="mt-1 text-[11px] text-stone-400">
              El saldo queda por cobrar; el plan de cuotas se crea después desde Contabilidad.
            </p>
          ) : null}
        </div>
        <CuentaSelect
          cuentas={cuentas}
          value={cuentaId}
          onChange={setCuentaId}
          label="Depositado en"
          monto={Number(amount) || 0}
          signo={1}
        />
        {modalidad === 'credito' ? (
          <div className="space-y-3 rounded-lg border border-brand/30 bg-green-50/50 p-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-stone-800">
              <input
                type="checkbox"
                checked={conPlan}
                onChange={(e) => setConPlan(e.target.checked)}
                className="h-4 w-4"
              />
              Armar el plan de cuotas ahora
            </label>
            {conPlan ? (
              <>
                {cond ? (
                  <p className="rounded-lg bg-white/70 p-2.5 text-xs text-stone-600">
                    Este lote entra en <strong>{cond.nombre}</strong>: inicial sugerida{' '}
                    <button
                      type="button"
                      className="font-semibold text-brand underline"
                      onClick={() => setAmount(String(cond.inicial_sugerida))}
                    >
                      {formatMoney(Number(cond.inicial_sugerida), 'BOB')}
                    </button>{' '}
                    ({cond.inicial_pct}%), interés{' '}
                    {anualDesdeMensual(Number(cond.interes_mensual_pct) || 0)}% anual, hasta{' '}
                    {cond.max_meses} meses.
                  </p>
                ) : (
                  <p className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900">
                    Ningún rango de precio cubre este lote: las condiciones se pactan a mano.
                    Definí la clasificación en Cobranza → Financiamiento.
                  </p>
                )}
                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-stone-500">Interés anual (%)</label>
                    <input
                      type="number"
                      min={0}
                      max={240}
                      step="0.1"
                      value={interesAnual}
                      onChange={(e) => setInteresAnual(e.target.value)}
                      className={inputClass}
                    />
                    {Number(interesAnual) > 0 ? (
                      <p className="mt-1 text-[11px] text-stone-500">
                        = {interes} % mensual sobre saldo
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-stone-500">Plazo (meses)</label>
                    <input
                      type="number"
                      min={1}
                      max={480}
                      value={meses}
                      onChange={(e) => setMeses(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-stone-500">
                      Cuota mensual (Bs)
                      {Number(interes) > 0 ? (
                        <span className="text-stone-400"> · calculada</span>
                      ) : null}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={Number(interes) > 0 ? (plan.cuota || '') : cuota}
                      onChange={(e) => setCuota(e.target.value)}
                      readOnly={Number(interes) > 0}
                      title={
                        Number(interes) > 0
                          ? `Con ${interes}% mensual sobre ${formatMoney(plan.financiar, 'BOB')} en ${plan.meses} meses`
                          : undefined
                      }
                      className={`${inputClass} ${
                        Number(interes) > 0 ? 'bg-stone-100 font-semibold text-stone-800' : ''
                      }`}
                    />
                    {plan.cuota > 0 && plan.interesTotal > 0 ? (
                      <p className="mt-1 text-[11px] leading-tight text-stone-600">
                        + <strong className="tabular-nums text-amber-700">
                          {formatMoney(plan.interesTotal, 'BOB')}
                        </strong>{' '}
                        de interés en {plan.meses} meses
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-stone-500">Primer vencimiento</label>
                    <input
                      type="date"
                      value={primerVenc}
                      onChange={(e) => setPrimerVenc(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>
                {plan.financiar <= 0 ? (
                  <p className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900">
                    La cuota inicial cubre el lote entero: no queda nada que financiar. Bajá la
                    inicial{cond ? ` (la sugerida es ${formatMoney(Number(cond.inicial_sugerida), 'BOB')})` : ''}{' '}
                    o registrá la venta al contado.
                  </p>
                ) : null}
                {plan.cuota > 0 ? (
                  <div className="rounded-lg border border-stone-200 bg-white p-3">
                    <p className="text-[10px] font-bold tracking-wider text-stone-400 uppercase">
                      Así queda el plan
                    </p>
                    <div className="mt-1.5 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
                      <div>
                        <p className="text-[11px] text-stone-500">Financia</p>
                        <p className="text-sm font-bold tabular-nums text-stone-800">
                          {formatMoney(plan.financiar, 'BOB')}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-stone-500">Paga por mes</p>
                        <p className="text-base font-black tabular-nums text-brand">
                          {formatMoney(plan.cuota, 'BOB')}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-stone-500">
                          Interés ({interesAnual}% anual · {plan.meses} m)
                        </p>
                        <p className="text-sm font-bold tabular-nums text-amber-700">
                          {formatMoney(plan.interesTotal, 'BOB')}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-stone-500">Termina pagando</p>
                        <p className="text-sm font-bold tabular-nums text-stone-800">
                          {formatMoney(plan.total, 'BOB')}
                        </p>
                      </div>
                    </div>
                    <p className="mt-2 text-center text-[11px] text-stone-500">
                      {plan.meses} cuotas de {formatMoney(plan.cuota, 'BOB')}
                      {plan.interesTotal > 0
                        ? ` — el lote cuesta ${formatMoney(precioEfectivo || 0, 'BOB')} y con el financiamiento termina pagando ${formatMoney(
                            Math.round(((plan.inicialBs || 0) + plan.total) * 100) / 100,
                            'BOB',
                          )}.`
                        : '.'}
                    </p>
                    {Number(interes) === 0 && cuota.trim() === '' ? (
                      <button
                        type="button"
                        className="mt-1 w-full text-center text-xs font-semibold text-brand underline"
                        onClick={() => setCuota(String(plan.cuota))}
                      >
                        Usar {formatMoney(plan.cuota, 'BOB')} como cuota
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-stone-500">
                Sin plan: el saldo queda por cobrar y el comprador abona cuando puede. El plan se
                puede crear después desde Contabilidad.
              </p>
            )}
          </div>
        ) : null}
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota (ej. pago en efectivo en oficina)" rows={2} className={inputClass} />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Volver
        </button>
        <button type="button" disabled={busy} className={btnPrimary} onClick={() => void sell()}>
          {busy ? 'Registrando…' : 'Registrar venta'}
        </button>
      </div>
    </Dialog>
  );
}

/**
 * Reservar un lote desde el mostrador.
 *
 * Crea una reserva de verdad — comprador, plazo, código de seguimiento y su
 * intención de pago — y recién entonces el lote queda 'reservado'. Es la razón
 * por la que el estado no se edita a mano: una reserva es lo que después
 * permite cobrar, extender el plazo, cancelar, o dejar que venza sola.
 */
export function ReserveDialog({
  lot,
  mzCode,
  currency,
  onClose,
  onReserved,
}: {
  lot: LoteParaVender;
  mzCode: string;
  currency: 'USD' | 'BOB';
  onClose: () => void;
  onReserved: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const [name, setName] = useState('');
  const [ci, setCi] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [hours, setHours] = useState('');
  const { equipo: equipoR, yo: yoR } = useEquipo();
  const [vendedorR, setVendedorR] = useState('');
  useEffect(() => {
    if (yoR && !vendedorR) setVendedorR(yoR);
  }, [yoR, vendedorR]);
  const [note, setNote] = useState('');
  // Cómo pagó. Antes iba escrito 'manual_qr' en la base para TODA venta de
  // oficina, así que el efectivo aparecía como plata que debía estar en el
  // extracto del banco. Se pregunta acá, que es cuando se sabe.
  const [forma, setForma] = useState<'efectivo' | 'manual_qr' | 'banco_ganadero' | 'bnb'>(
    'efectivo',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reserve() {
    setError(null);
    if (name.trim().length < 5) {
      setError('Escribe el nombre completo del comprador.');
      return;
    }
    if (!ciSchema.safeParse(ci).success) {
      setError('Carnet inválido (ej: 7896541 o 7896541-1E).');
      return;
    }
    if (!phoneSchema.safeParse(phone).success) {
      setError('Celular boliviano inválido (8 dígitos, empieza con 6 o 7).');
      return;
    }
    // El correo deja de ser opcional: es por donde le llega al comprador la
    // confirmación y el enlace a su reserva, y sin él la única vía de contacto
    // es el celular que alguien tecleó a mano.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setError('Escribe el correo del comprador: por ahí le llega su reserva y sus recibos.');
      return;
    }
    const h = hours.trim() === '' ? null : Number(hours);
    if (h !== null && (!Number.isInteger(h) || h < 1 || h > 720)) {
      setError('El plazo debe ser un número entero de 1 a 720 horas.');
      return;
    }

    setBusy(true);
    const { data, error: err } = await supabase.rpc('admin_reserve_offline', {
      p_lot_id: lot.id,
      p_full_name: name.trim(),
      p_ci: ci.trim(),
      p_phone: phone.trim(),
      p_email: email.trim(),
      p_hours: h,
      p_note: note.trim() || null,
      p_provider: forma,
      p_sold_by: vendedorR || null,
    });
    setBusy(false);
    if (err) {
      setError(adminErrorCopy(err.message));
      return;
    }
    const res = data as { tracking_code?: string; reference_code?: string } | null;
    push(
      `Lote reservado${res?.tracking_code ? ` — código ${res.tracking_code}` : ''}.` +
        (res?.reference_code ? ` Glosa: ${res.reference_code}` : ''),
      'success',
    );
    onReserved();
  }

  return (
    <Dialog open onClose={onClose} title={`Reservar en oficina — Mz ${mzCode}, Lote ${lot.number}`}>
      <div className="space-y-3">
        <p className="rounded-lg bg-stone-50 p-3 text-xs text-stone-600">
          Queda igual que una reserva hecha desde el mapa: con su plazo, su código y su glosa de
          pago. Si no se paga, vence sola y el lote vuelve a estar disponible.
        </p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre completo"
          className={inputClass}
        />
        <div className="grid grid-cols-2 gap-3">
          <input
            value={ci}
            onChange={(e) => setCi(e.target.value)}
            placeholder="Carnet (CI)"
            className={inputClass}
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Celular"
            inputMode="tel"
            className={inputClass}
          />
        </div>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Correo del comprador"
          inputMode="email"
          className={inputClass}
        />
        <div>
          <label className="mb-1 block text-xs text-stone-500">Forma de pago</label>
          <select
            value={forma}
            onChange={(e) => setForma(e.target.value as typeof forma)}
            className={inputClass}
          >
            <option value="efectivo">Efectivo</option>
            <option value="manual_qr">QR / transferencia</option>
            <option value="banco_ganadero">Banco Ganadero</option>
            <option value="bnb">BNB</option>
          </select>
          <p className="mt-1 text-[11px] text-stone-400">
            Queda registrada desde el arranque: el efectivo hay que arquearlo, el QR tiene que
            aparecer en el extracto.
          </p>
        </div>

        <VendedorSelect
          equipo={equipoR}
          value={vendedorR}
          onChange={setVendedorR}
          label="Quién toma la reserva"
        />
        <div>
          <label className="mb-1 block text-xs text-stone-500">
            Plazo en horas — vacío usa el del proyecto (48 h)
          </label>
          <input
            type="number"
            min={1}
            max={720}
            step={1}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="48"
            className={inputClass}
          />
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Nota (ej. seña entregada en oficina)"
          rows={2}
          className={inputClass}
        />
        <p className="text-xs text-stone-400">
          La seña a cobrar sale de la configuración del proyecto, la misma que usa el mapa público,
          en {currency === 'BOB' ? 'bolivianos' : 'dólares'}.
        </p>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Volver
        </button>
        <button type="button" disabled={busy} className={btnPrimary} onClick={() => void reserve()}>
          {busy ? 'Reservando…' : 'Crear reserva'}
        </button>
      </div>
    </Dialog>
  );
}
