import { formatMoney } from '@/lib/format';
import { LogoMark } from '@/components/Logo';

// El plan de pago impreso: el papel que el comprador se lleva y pega en la
// heladera.
//
// Tiene que responder sin preguntarle a nadie: cuánto pago por mes, qué día
// vence cada cuota, cuánto de eso es capital y cuánto interés, y cuánto me va
// quedando. Por eso el cronograma va cuota por cuota con saldo corriente — un
// resumen bonito no sirve para el 14 de cada mes.
//
// Se arma desde la base, así que si mañana abona a capital y el plan se
// rearma, el papel nuevo dice la verdad nueva.

export interface CuotaImpresa {
  number: number;
  due_date: string;
  amount: number;
  interes: number;
  amount_paid: number;
  status: string;
}

export interface PlanImpreso {
  plan_id: string;
  proyecto: string;
  tracking_code: string;
  buyer_full_name: string;
  buyer_ci: string;
  buyer_phone: string;
  manzana: string | null;
  lote: string | null;
  estado: string;
  total_price: number;
  down_payment: number;
  financed_amount: number;
  months: number;
  monthly_amount: number;
  monthly_interest_pct: number;
  first_due_date: string;
  cuotas: CuotaImpresa[];
}

function fecha(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-BO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/La_Paz',
  });
}

export function PlanDePago({ p, emitidoPor }: { p: PlanImpreso; emitidoPor?: string }) {
  const totalCuotas = p.cuotas.reduce((s, c) => s + Number(c.amount), 0);
  const totalInteres = p.cuotas.reduce((s, c) => s + Number(c.interes), 0);
  const pagado = p.cuotas.reduce((s, c) => s + Number(c.amount_paid), 0);

  // El saldo corriente: lo que le queda por pagar DESPUÉS de cada cuota. Es la
  // columna que el comprador busca con el dedo.
  let restante = totalCuotas;

  return (
    <article className="rounded-2xl border border-stone-300 bg-white p-8 text-sm print:rounded-none print:border-0 print:p-0">
      <header className="flex items-start justify-between gap-4 border-b-2 border-brand pb-4">
        <div className="flex items-center gap-3">
          <LogoMark className="h-10 w-10" />
          <div>
            <p className="text-lg font-black tracking-tight text-stone-900">TERRENALV S.R.L.</p>
            <p className="text-xs text-stone-500">
              Urbanización {p.proyecto} · Zanja Honda, Santa Cruz
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
            Plan de pago
          </p>
          <p className="font-mono text-sm font-bold text-stone-900">{p.tracking_code}</p>
          <p className="text-xs text-stone-500">
            {p.estado === 'activo' ? 'Vigente' : p.estado}
          </p>
        </div>
      </header>

      <section className="mt-5 grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-stone-500">Comprador</p>
          <p className="font-semibold text-stone-900">{p.buyer_full_name}</p>
          <p className="text-xs text-stone-500">
            CI {p.buyer_ci} · {p.buyer_phone}
          </p>
        </div>
        <div>
          <p className="text-xs text-stone-500">Lote</p>
          <p className="font-semibold text-stone-900">
            Manzana {p.manzana ?? '—'}, Lote {p.lote ?? '—'}
          </p>
        </div>
      </section>

      {/* ---- Las condiciones, en una línea que se entiende ---- */}
      <section className="mt-5 grid grid-cols-2 gap-3 rounded-lg bg-stone-50 p-4 sm:grid-cols-4 print:ring-1 print:ring-stone-300">
        <div>
          <p className="text-xs text-stone-500">Precio del lote</p>
          <p className="font-bold tabular-nums">{formatMoney(Number(p.total_price), 'BOB')}</p>
        </div>
        <div>
          <p className="text-xs text-stone-500">Cuota inicial</p>
          <p className="font-bold tabular-nums">{formatMoney(Number(p.down_payment), 'BOB')}</p>
        </div>
        <div>
          <p className="text-xs text-stone-500">Financiado</p>
          <p className="font-bold tabular-nums">{formatMoney(Number(p.financed_amount), 'BOB')}</p>
        </div>
        <div>
          <p className="text-xs text-stone-500">Cuota mensual</p>
          <p className="text-base font-black tabular-nums text-brand">
            {formatMoney(Number(p.monthly_amount), 'BOB')}
          </p>
        </div>
      </section>

      <p className="mt-2 text-xs text-stone-600">
        {p.months} cuotas mensuales
        {Number(p.monthly_interest_pct) > 0 ? (
          <>
            {' '}
            con <strong>{Number(p.monthly_interest_pct)}% de interés mensual sobre saldo</strong>.
            Interés total del plan: {formatMoney(totalInteres, 'BOB')}. Termina pagando{' '}
            <strong>{formatMoney(totalCuotas, 'BOB')}</strong> por el financiamiento.
          </>
        ) : (
          <> sin interés.</>
        )}{' '}
        La primera vence el {fecha(p.first_due_date)}.
      </p>

      {/* ---- El cronograma, cuota por cuota ---- */}
      <table className="mt-5 w-full border-collapse text-xs">
        <thead>
          <tr className="border-y border-stone-300 text-left">
            <th className="py-2 font-semibold text-stone-500">N°</th>
            <th className="py-2 font-semibold text-stone-500">Vence</th>
            <th className="py-2 text-right font-semibold text-stone-500">Cuota</th>
            <th className="py-2 text-right font-semibold text-stone-500">Capital</th>
            <th className="py-2 text-right font-semibold text-stone-500">Interés</th>
            <th className="py-2 text-right font-semibold text-stone-500">Le queda</th>
            <th className="py-2 text-center font-semibold text-stone-500">Estado</th>
          </tr>
        </thead>
        <tbody>
          {p.cuotas.map((c) => {
            restante = Math.round((restante - Number(c.amount)) * 100) / 100;
            const pagada = c.status === 'pagada';
            return (
              <tr key={c.number} className="border-b border-stone-100">
                <td className="py-1.5 tabular-nums">{c.number}</td>
                <td className="py-1.5">{fecha(c.due_date)}</td>
                <td className="py-1.5 text-right font-semibold tabular-nums">
                  {formatMoney(Number(c.amount), 'BOB')}
                </td>
                <td className="py-1.5 text-right tabular-nums text-stone-600">
                  {formatMoney(Number(c.amount) - Number(c.interes), 'BOB')}
                </td>
                <td className="py-1.5 text-right tabular-nums text-stone-500">
                  {Number(c.interes) > 0 ? formatMoney(Number(c.interes), 'BOB') : '—'}
                </td>
                <td className="py-1.5 text-right tabular-nums text-stone-600">
                  {formatMoney(Math.max(0, restante), 'BOB')}
                </td>
                <td className="py-1.5 text-center">
                  {pagada ? (
                    <span className="font-semibold text-brand">Pagada</span>
                  ) : Number(c.amount_paid) > 0 ? (
                    <span className="text-amber-700">
                      Parcial {formatMoney(Number(c.amount_paid), 'BOB')}
                    </span>
                  ) : (
                    <span className="text-stone-400">Pendiente</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-stone-300">
            <td className="pt-2 font-semibold text-stone-600" colSpan={2}>
              Totales
            </td>
            <td className="pt-2 text-right font-black tabular-nums">
              {formatMoney(totalCuotas, 'BOB')}
            </td>
            <td className="pt-2 text-right font-semibold tabular-nums">
              {formatMoney(totalCuotas - totalInteres, 'BOB')}
            </td>
            <td className="pt-2 text-right font-semibold tabular-nums">
              {formatMoney(totalInteres, 'BOB')}
            </td>
            <td className="pt-2 text-right text-stone-500" colSpan={2}>
              Pagado a la fecha: {formatMoney(pagado, 'BOB')}
            </td>
          </tr>
        </tfoot>
      </table>

      <section className="mt-6 rounded-lg bg-stone-50 p-3 text-xs text-stone-600 print:ring-1 print:ring-stone-300">
        <p>
          <strong>Cómo pagar:</strong> en la oficina de Terrenalv, en efectivo, por QR o
          transferencia. Cada pago se registra en el acto y recibís tu recibo. Si adelantás plata a
          capital, el plan se recalcula y podés elegir terminar antes o bajar la cuota.
        </p>
      </section>

      <footer className="mt-6 border-t border-stone-200 pt-4 text-xs text-stone-500">
        <p>
          Cronograma emitido por Terrenalv S.R.L. sobre el plan vigente al día de impresión.{' '}
          <strong>No constituye factura</strong>: la factura fiscal se emite por separado a través
          del Servicio de Impuestos Nacionales. Terrenalv conserva la propiedad del lote hasta la
          cancelación total del precio.
        </p>
        {emitidoPor ? <p className="mt-2">Emitido por {emitidoPor}</p> : null}
      </footer>
    </article>
  );
}
