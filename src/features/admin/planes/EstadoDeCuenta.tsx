import Link from 'next/link';
import { formatMoney } from '@/lib/format';
import { saldosCorridos } from './cuentas';
import { Logo } from '@/components/Logo';
import type { EstadoDeCuenta as Datos } from './estado-de-cuenta';

// El estado de cuenta que ve el comprador con su enlace.
//
// Un solo papel que sirve en todos los momentos de su compra: mientras junta
// la cuota inicial, mientras paga sus cuotas, cuando termina de pagar y
// también si cedió el lote. Se arma desde la base en cada visita, así que el
// enlace nunca queda viejo: el pago que registró la oficina hace diez minutos
// ya está acá.

function fecha(iso: string | null): string {
  if (!iso) return '—';
  const d = iso.length <= 10 ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return d.toLocaleDateString('es-BO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/La_Paz',
  });
}

export function EstadoDeCuenta({ d }: { d: Datos }) {
  const totalCuotas = d.plan ? d.plan.cuotas.reduce((s, c) => s + Number(c.amount), 0) : 0;
  const totalInteres = d.plan ? d.plan.cuotas.reduce((s, c) => s + Number(c.interes), 0) : 0;
  // El «te queda» de cada fila sale de cuentas.ts — la misma cuenta que usa
  // el PDF, con sus tests. Dos copias de esta aritmética ya se contradijeron
  // una vez en producción.
  const saldos = d.plan ? saldosCorridos(d.plan.cuotas) : [];

  return (
    <article className="rounded-2xl border border-stone-300 bg-white p-6 text-sm sm:p-8 print:rounded-none print:border-0 print:p-0">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-brand pb-4">
        <div>
          <Logo className="h-9 w-auto" />
          <p className="mt-1.5 text-xs text-stone-500">
            TERRENALV S.R.L. · Urbanización {d.proyecto}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
            Estado de cuenta
          </p>
          <p className="font-mono text-sm font-bold text-stone-900">{d.tracking_code}</p>
          <p className="text-xs text-stone-500">Al {fecha(new Date().toISOString())}</p>
        </div>
      </header>

      <section className="mt-5 grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-stone-500">Comprador</p>
          <p className="font-semibold text-stone-900">{d.buyer_full_name}</p>
          <p className="text-xs text-stone-500">CI {d.buyer_ci}</p>
        </div>
        <div>
          <p className="text-xs text-stone-500">Lote</p>
          <p className="font-semibold text-stone-900">
            Manzana {d.manzana ?? '—'}, Lote {d.lote ?? '—'}
          </p>
          {d.area_m2 !== null ? (
            <p className="text-xs text-stone-500">{d.area_m2.toFixed(0)} m²</p>
          ) : null}
        </div>
      </section>

      {/* ---- Dónde está parada esta compra ---- */}
      {d.situacion === 'cedida' ? (
        <p className="mt-5 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
          Traspasaste este lote a <strong>{d.cedida_a}</strong>. Abajo queda la historia de lo que
          pagaste: tus recibos siguen a tu nombre.
        </p>
      ) : null}

      {d.situacion === 'cerrada' ? (
        <p className="mt-5 rounded-lg border border-stone-300 bg-stone-50 p-3 text-sm text-stone-700">
          Esta reserva ya no está vigente. Si querés retomarla, pasá por la oficina — abajo está
          todo lo que pagaste.
        </p>
      ) : null}

      {d.situacion === 'reserva' ? (
        <section className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">
            Estás juntando tu cuota inicial
          </p>
          <div className="mt-2 grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-[11px] text-stone-500">Pagaste</p>
              <p className="font-bold tabular-nums">{formatMoney(d.pagado, 'BOB')}</p>
            </div>
            <div>
              <p className="text-[11px] text-stone-500">Cuota inicial</p>
              <p className="font-bold tabular-nums">
                {formatMoney(d.inicial_objetivo, 'BOB')}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-stone-500">Te falta</p>
              <p className="font-bold tabular-nums text-amber-800">
                {formatMoney(d.falta_para_inicial, 'BOB')}
              </p>
            </div>
          </div>
          {d.inicial_objetivo > 0 ? (
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
              <div
                className="h-full bg-brand"
                style={{
                  width: `${Math.min(100, Math.round((d.pagado / d.inicial_objetivo) * 100))}%`,
                }}
              />
            </div>
          ) : null}
          <p className="mt-2 text-xs text-amber-900">
            Tu lote está guardado{d.vence ? ` hasta el ${fecha(d.vence)}` : ''}. Al completar la
            cuota inicial, tu compra queda firme y armamos tu plan de cuotas.
          </p>
        </section>
      ) : null}

      {d.situacion === 'venta' ? (
        <section className="mt-5 grid grid-cols-3 gap-3 rounded-lg bg-stone-50 p-4 text-center print:ring-1 print:ring-stone-300">
          <div>
            <p className="text-xs text-stone-500">Precio del lote</p>
            <p className="font-bold tabular-nums">{formatMoney(d.precio, 'BOB')}</p>
          </div>
          <div>
            <p className="text-xs text-stone-500">Pagaste</p>
            <p className="font-bold tabular-nums text-brand">{formatMoney(d.pagado, 'BOB')}</p>
          </div>
          <div>
            <p className="text-xs text-stone-500">Te queda</p>
            <p
              className={`text-lg font-black tabular-nums ${
                d.saldo > 0 ? 'text-stone-900' : 'text-brand'
              }`}
            >
              {d.saldo > 0 ? formatMoney(d.saldo, 'BOB') : '¡Pagado!'}
            </p>
          </div>
        </section>
      ) : null}

      {/* ---- El plan, si tiene ---- */}
      {d.plan ? (
        <>
          <h2 className="mt-6 text-xs font-bold tracking-wide text-stone-500 uppercase">
            Tu plan de cuotas
            {d.plan.estado !== 'activo' ? ` · ${d.plan.estado}` : ''}
          </h2>
          <p className="mt-1 text-xs text-stone-600">
            {Number(d.plan.cuotas_totales) === Number(d.plan.months) ? (
              <>
                {d.plan.months} cuotas de{' '}
                <strong>{formatMoney(Number(d.plan.monthly_amount), 'BOB')}</strong>
              </>
            ) : (
              // El plan se reprogramó, así que las cuotas ya pagadas fueron de
              // otro monto. Decir «8 cuotas de Bs 5.156» al lado de «llevás 1
              // de 9» se contradice solo: son ocho las que faltan, no ocho las
              // que hay. Se nombra el total y se aclara qué queda.
              <>
                {d.plan.cuotas_totales} cuotas · las{' '}
                {Number(d.plan.cuotas_totales) - Number(d.plan.cuotas_pagadas)} que faltan son de{' '}
                <strong>{formatMoney(Number(d.plan.monthly_amount), 'BOB')}</strong>
              </>
            )}
            {Number(d.plan.monthly_interest_pct) > 0 ? (
              <>
                {' '}
                con {Number(d.plan.monthly_interest_pct)}% de interés mensual sobre saldo · interés
                total {formatMoney(totalInteres, 'BOB')} · pagás{' '}
                {formatMoney(totalCuotas, 'BOB')} en total
              </>
            ) : null}
            . Llevás {d.plan.cuotas_pagadas} de {d.plan.cuotas_totales} cuotas
            {d.plan.proxima_cuota ? ` · la próxima vence el ${fecha(d.plan.proxima_cuota)}` : ''}.
          </p>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-y border-stone-300 text-left">
                  <th className="py-2 font-semibold text-stone-500">N°</th>
                  <th className="py-2 font-semibold text-stone-500">Vence</th>
                  <th className="py-2 text-right font-semibold text-stone-500">Cuota</th>
                  <th className="py-2 text-right font-semibold text-stone-500">Te queda</th>
                  <th className="py-2 text-center font-semibold text-stone-500">Estado</th>
                </tr>
              </thead>
              <tbody>
                {d.plan.cuotas.map((c, i) => {
                  const hoy = new Date().toISOString().slice(0, 10);
                  const vencida = c.status !== 'pagada' && c.due_date < hoy;
                  return (
                    <tr key={c.number} className="border-b border-stone-100">
                      <td className="py-1.5 tabular-nums">{c.number}</td>
                      <td className={`py-1.5 ${vencida ? 'font-semibold text-red-600' : ''}`}>
                        {fecha(c.due_date)}
                      </td>
                      <td className="py-1.5 text-right font-semibold tabular-nums">
                        {formatMoney(Number(c.amount), 'BOB')}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-stone-600">
                        {formatMoney(saldos[i], 'BOB')}
                      </td>
                      <td className="py-1.5 text-center">
                        {c.status === 'pagada' ? (
                          <span className="font-semibold text-brand">Pagada</span>
                        ) : Number(c.amount_paid) > 0 ? (
                          <span className="text-amber-700">
                            Parcial {formatMoney(Number(c.amount_paid), 'BOB')}
                          </span>
                        ) : vencida ? (
                          <span className="font-semibold text-red-600">Vencida</span>
                        ) : (
                          <span className="text-stone-400">Pendiente</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : d.situacion === 'venta' ? (
        <p className="mt-5 rounded-lg bg-stone-50 p-3 text-xs text-stone-600">
          No tenés un plan de cuotas armado: vas pagando por abonos, cuando puedas. Si querés un
          cronograma fijo, pedilo en la oficina.
        </p>
      ) : null}

      {/* ---- Cada peso que pagó, con su recibo ---- */}
      <h2 className="mt-6 text-xs font-bold tracking-wide text-stone-500 uppercase">
        Tus pagos — {d.pagos.filter((p) => p.estado === 'aprobado').length}
      </h2>
      {d.pagos.length === 0 ? (
        <p className="mt-2 text-sm text-stone-500">Todavía no hay pagos registrados.</p>
      ) : (
        <ul className="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200">
          {d.pagos.map((p) => (
            <li
              key={p.payment_id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
            >
              <span className="text-xs text-stone-500">{fecha(p.fecha ?? p.created_at)}</span>
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold text-stone-600">
                {p.tipo}
              </span>
              <span className="text-xs text-stone-400">{p.forma}</span>
              {p.de_comprador_anterior ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                  pagó {p.pagado_por.split(' ')[0]}
                </span>
              ) : null}
              {p.estado !== 'aprobado' ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                  {p.estado}
                </span>
              ) : null}
              <span
                className={`ml-auto font-semibold tabular-nums ${
                  p.estado === 'aprobado' ? 'text-stone-900' : 'text-stone-400 line-through'
                }`}
              >
                {formatMoney(p.amount, p.currency)}
              </span>
              {p.tiene_recibo && !p.de_comprador_anterior ? (
                <Link
                  href={`/reserva/${encodeURIComponent(d.tracking_code)}/recibo/${p.payment_id}`}
                  className="text-xs font-semibold text-brand hover:underline print:hidden"
                >
                  Recibo
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <footer className="mt-6 border-t border-stone-200 pt-4 text-xs text-stone-500">
        <p>
          Estado de cuenta emitido por Terrenalv S.R.L. Se actualiza solo: cada pago que registrás
          en oficina aparece acá al instante. <strong>No constituye factura</strong>: la factura
          fiscal se emite por separado a través del Servicio de Impuestos Nacionales.
        </p>
      </footer>
    </article>
  );
}
