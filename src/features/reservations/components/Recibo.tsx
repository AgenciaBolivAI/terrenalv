import { Logo } from '@/components/Logo';
import { formatMoney } from '@/lib/format';
import type { ReciboData } from '../recibo';

// El papel que se le da al comprador por su pago.
//
// Un comprador que entrega Bs 2.400 en el mostrador pide un papel, y el mismo
// papel tiene que poder verlo después desde su celular. Por eso el recibo es un
// componente y no una página: lo usan el panel y la página del comprador, y así
// no pueden divergir.
//
// Esto NO es una factura. Una factura boliviana necesita CUF, CUFD y
// certificado digital contra el SIN; decirle "factura" sería un problema
// tributario, no un detalle de redacción. El pie lo dice.

const FORMA_DE_PAGO: Record<string, string> = {
  efectivo: 'Efectivo',
  manual_qr: 'QR / transferencia',
  banco_ganadero: 'Banco Ganadero',
  bnb: 'BNB',
};

function laPaz(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-BO', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/La_Paz',
  }).format(new Date(iso));
}

export function Recibo({ r, emitidoPor }: { r: ReciboData; emitidoPor?: string }) {
  return (
    <article className="rounded-2xl border border-stone-300 bg-white p-8 print:rounded-none print:border-0 print:p-0">
      <header className="flex items-start justify-between gap-4 border-b-2 border-brand pb-4">
        <div>
          <Logo className="h-10 w-auto" />
          <p className="mt-2 text-xs text-stone-500">
            TERRENALV S.R.L. · Urbanización {r.proyecto}
            <br />
            Zanja Honda, Cabezas — Santa Cruz, Bolivia
            <br />
            Carretera internacional Argentina — Paraguay
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Recibo</p>
          <p className="font-mono text-sm font-bold text-stone-900">{r.reference_code}</p>
          <p className="mt-1 text-xs text-stone-500">{laPaz(r.verified_at ?? r.created_at)}</p>
        </div>
      </header>

      <section className="mt-6 grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-xs text-stone-500">Recibimos de</p>
          <p className="font-semibold text-stone-900">{r.buyer_full_name}</p>
          <p className="text-xs text-stone-500">
            CI {r.buyer_ci} · {r.buyer_phone}
          </p>
        </div>
        <div>
          <p className="text-xs text-stone-500">Lote</p>
          <p className="font-semibold text-stone-900">
            Manzana {r.manzana}, Lote {r.lote}
          </p>
          <p className="font-mono text-xs text-stone-500">{r.tracking_code}</p>
        </div>
      </section>

      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-y border-stone-300 text-left">
            <th className="py-2 text-xs font-semibold text-stone-500 uppercase">Concepto</th>
            <th className="py-2 text-xs font-semibold text-stone-500 uppercase">Forma de pago</th>
            <th className="py-2 text-right text-xs font-semibold text-stone-500 uppercase">
              Importe
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-stone-200">
            <td className="py-3 text-stone-800">
              {r.purpose === 'cuota'
                ? 'Cuota del plan de pago'
                : r.purpose === 'abono'
                  ? 'Abono al lote'
                  : r.purpose === 'comision'
                    ? 'Comisión por venta en el mercado de traspasos'
                    : 'Seña / reserva del lote'}
            </td>
            <td className="py-3 text-stone-600">{FORMA_DE_PAGO[r.provider] ?? r.provider}</td>
            <td className="py-3 text-right font-bold tabular-nums text-stone-900">
              {formatMoney(r.amount, r.currency)}
              {r.currency !== 'BOB' ? (
                <span className="block text-xs font-normal text-stone-500">
                  = {formatMoney(r.amount_bob, 'BOB')}
                  {r.exchange_rate_used ? ` (t/c ${r.exchange_rate_used})` : ''}
                </span>
              ) : null}
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td className="pt-3 text-xs text-stone-500" colSpan={2}>
              Total recibido
            </td>
            <td className="pt-3 text-right text-lg font-black tabular-nums text-brand">
              {formatMoney(r.amount, r.currency)}
            </td>
          </tr>
        </tfoot>
      </table>

      {r.purpose === 'comision' ? null : (
      <section className="mt-6 grid grid-cols-3 gap-3 rounded-lg bg-stone-50 p-4 text-sm print:bg-white print:ring-1 print:ring-stone-300">
        <div>
          <p className="text-xs text-stone-500">Precio del lote</p>
          <p className="font-semibold tabular-nums">{formatMoney(r.price_agreed, r.currency)}</p>
        </div>
        <div>
          <p className="text-xs text-stone-500">Pagado a la fecha</p>
          <p className="font-semibold tabular-nums text-brand">
            {formatMoney(r.pagado_total, 'BOB')}
          </p>
        </div>
        <div>
          <p className="text-xs text-stone-500">Saldo</p>
          <p className="font-semibold tabular-nums">{formatMoney(r.saldo, 'BOB')}</p>
        </div>
      </section>
      )}

      <footer className="mt-8 border-t border-stone-200 pt-4 text-xs text-stone-500">
        <p>
          Recibo interno de Terrenalv S.R.L. por el pago detallado arriba.{' '}
          <strong>No constituye factura</strong>: la factura fiscal se emite por separado a través
          del Servicio de Impuestos Nacionales.
        </p>
        {emitidoPor ? <p className="mt-2">Emitido por {emitidoPor}</p> : null}
      </footer>
    </article>
  );
}
