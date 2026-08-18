import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { formatMoney } from '@/lib/format';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAdminContext } from '@/features/admin/lib/get-admin-context';
import { PrintButton } from '@/features/admin/contabilidad/PrintButton';

export const metadata: Metadata = { title: 'Recibo' };
export const dynamic = 'force-dynamic';

// Recibo de un pago, para imprimir o mandar por WhatsApp.
//
// Un comprador que entrega Bs 2.400 en el mostrador pide un papel, y hasta
// ahora no había forma de dárselo desde el sistema: el pago quedaba registrado
// y el cliente se iba con las manos vacías.
//
// Esto NO es una factura. Una factura boliviana necesita estar emitida contra
// el SIN con CUF, CUFD y certificado digital a nombre de Terrenalv; decirle
// "factura" a esto sería un problema tributario, no un detalle de redacción.
// Es un recibo interno, y el pie lo dice.
//
// Vive fuera del shell del panel a propósito: al imprimir no debe salir la
// navegación.

interface Row {
  id: string;
  reservation_id: string;
  reference_code: string;
  purpose: string;
  amount: number;
  currency: 'BOB' | 'USD';
  amount_bob: number;
  provider: string;
  verified_at: string | null;
  created_at: string;
  status: string;
  reservations: {
    tracking_code: string;
    buyer_full_name: string;
    buyer_ci: string;
    buyer_phone: string;
    price_agreed: number;
    currency: 'BOB' | 'USD';
    lots: { number: string; manzanas: { code: string } | null } | null;
  } | null;
}

const PROVIDER_LABEL: Record<string, string> = {
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

export default async function ReciboPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    if (ctx.reason === 'auth') redirect('/admin/login');
    return null;
  }

  const { id } = await params;
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('payments')
    .select(
      'id, reservation_id, reference_code, purpose, amount, currency, amount_bob, provider, verified_at, created_at, status, ' +
        'reservations!payments_reservation_id_fkey(tracking_code, buyer_full_name, buyer_ci, buyer_phone, price_agreed, currency, lots!reservations_lot_id_fkey(number, manzanas(code)))',
    )
    .eq('id', id)
    .maybeSingle();

  const pay = data as unknown as Row | null;
  if (!pay) notFound();

  const res = pay.reservations;
  const mz = res?.lots?.manzanas?.code ?? '—';
  const lote = res?.lots?.number ?? '—';

  // What the buyer has paid in total on this lot, so the receipt answers the
  // question they actually ask: "¿cuánto llevo pagado?"
  let pagadoTotal = 0;
  let saldo: number | null = null;
  if (res) {
    const { data: all } = await supabase
      .from('payments')
      .select('amount')
      .eq('reservation_id', pay.reservation_id)
      .eq('status', 'aprobado');
    pagadoTotal = (all ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0);
    saldo = Number(res.price_agreed) - pagadoTotal;
  }

  return (
    <main className="mx-auto max-w-2xl p-6 print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <a href="/admin/contabilidad?tab=cobrar" className="text-sm font-semibold text-brand hover:underline">
          ← Volver
        </a>
        <PrintButton />
      </div>

      <article className="rounded-2xl border border-stone-300 bg-white p-8 print:rounded-none print:border-0 print:p-0">
        <header className="flex items-start justify-between gap-4 border-b-2 border-brand pb-4">
          <div>
            <Logo className="h-10 w-auto" />
            <p className="mt-2 text-xs text-stone-500">
              TERRENALV S.R.L. · Urbanización Prados del Sur
              <br />
              Zanja Honda, Cabezas — Santa Cruz, Bolivia
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Recibo</p>
            <p className="font-mono text-sm font-bold text-stone-900">{pay.reference_code}</p>
            <p className="mt-1 text-xs text-stone-500">{laPaz(pay.verified_at ?? pay.created_at)}</p>
          </div>
        </header>

        <section className="mt-6 grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-stone-500">Recibimos de</p>
            <p className="font-semibold text-stone-900">{res?.buyer_full_name ?? '—'}</p>
            <p className="text-xs text-stone-500">CI {res?.buyer_ci ?? '—'} · {res?.buyer_phone ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-stone-500">Lote</p>
            <p className="font-semibold text-stone-900">Manzana {mz}, Lote {lote}</p>
            <p className="font-mono text-xs text-stone-500">{res?.tracking_code ?? '—'}</p>
          </div>
        </section>

        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-y border-stone-300 text-left">
              <th className="py-2 text-xs font-semibold text-stone-500 uppercase">Concepto</th>
              <th className="py-2 text-xs font-semibold text-stone-500 uppercase">Forma de pago</th>
              <th className="py-2 text-right text-xs font-semibold text-stone-500 uppercase">Importe</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-stone-200">
              <td className="py-3 text-stone-800">
                {pay.purpose === 'cuota' ? 'Cuota del plan de pago' : 'Seña / reserva del lote'}
              </td>
              <td className="py-3 text-stone-600">{PROVIDER_LABEL[pay.provider] ?? pay.provider}</td>
              <td className="py-3 text-right font-bold tabular-nums text-stone-900">
                {formatMoney(Number(pay.amount), pay.currency)}
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td className="pt-3 text-xs text-stone-500" colSpan={2}>
                Total recibido
              </td>
              <td className="pt-3 text-right text-lg font-black tabular-nums text-brand">
                {formatMoney(Number(pay.amount), pay.currency)}
              </td>
            </tr>
          </tfoot>
        </table>

        {res ? (
          <section className="mt-6 grid grid-cols-3 gap-3 rounded-lg bg-stone-50 p-4 text-sm print:bg-white print:ring-1 print:ring-stone-300">
            <div>
              <p className="text-xs text-stone-500">Precio del lote</p>
              <p className="font-semibold tabular-nums">{formatMoney(Number(res.price_agreed), res.currency)}</p>
            </div>
            <div>
              <p className="text-xs text-stone-500">Pagado a la fecha</p>
              <p className="font-semibold tabular-nums text-brand">{formatMoney(pagadoTotal, res.currency)}</p>
            </div>
            <div>
              <p className="text-xs text-stone-500">Saldo</p>
              <p className="font-semibold tabular-nums">{formatMoney(Math.max(0, saldo ?? 0), res.currency)}</p>
            </div>
          </section>
        ) : null}

        <footer className="mt-8 border-t border-stone-200 pt-4 text-xs text-stone-500">
          <p>
            Recibo interno de Terrenalv S.R.L. por el pago detallado arriba.{' '}
            <strong>No constituye factura</strong>: la factura fiscal se emite por separado a
            través del Servicio de Impuestos Nacionales.
          </p>
          <p className="mt-2">
            Estado del pago: <strong>{pay.status}</strong> · Emitido por {ctx.profile.full_name}
          </p>
        </footer>
      </article>
    </main>
  );
}
