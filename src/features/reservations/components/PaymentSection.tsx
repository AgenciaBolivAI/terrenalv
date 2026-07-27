'use client';

// "Cómo pagar" card: bank QR (signed URL), exact amount in Bs, bank data and
// the glosa reference code. This is where money anxiety lives — everything is
// explicit and copyable.

import { formatMoney } from '@/lib/format';
import type { TrackedReservation } from '../lib/api';
import { CopyButton } from './CopyButton';

function DataRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-sm text-stone-500">{label}</dt>
      <dd className="text-right text-sm font-semibold text-stone-800">{value}</dd>
    </div>
  );
}

export function PaymentSection({ data }: { data: TrackedReservation }) {
  const ins = data.payment_instructions;
  const pay = data.payment;
  const amountBob =
    pay?.amount_bob ?? (data.amount_due_currency === 'BOB' ? data.amount_due : null);
  const original = pay ?? {
    amount: data.amount_due,
    currency: data.amount_due_currency,
    reference_code: null as string | null,
  };

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-bold uppercase tracking-wide text-brand">
        Paga la seña con QR
      </h2>

      {/* Amount — the biggest thing on the card */}
      <div className="mt-3 rounded-xl bg-green-50 p-3 text-center">
        <p className="text-xs uppercase tracking-wide text-stone-500">Monto exacto a transferir</p>
        <p className="text-4xl font-extrabold tracking-tight text-brand">
          {amountBob !== null
            ? formatMoney(amountBob, 'BOB')
            : formatMoney(original.amount, original.currency)}
        </p>
        {original.currency === 'USD' && amountBob !== null ? (
          <p className="mt-0.5 text-xs text-stone-500">
            Equivale a {formatMoney(original.amount, 'USD')}
          </p>
        ) : null}
      </div>

      {/* QR image */}
      {data.qr_url ? (
        <div className="mt-4 text-center">
          <a href={data.qr_url} target="_blank" rel="noreferrer" className="inline-block">
            {/* Signed URL from a private bucket — plain <img> on purpose. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={data.qr_url}
              alt="QR de pago del banco"
              className="mx-auto h-56 w-56 rounded-xl border border-stone-200 bg-white object-contain p-2"
            />
          </a>
          <p className="mt-1 text-xs text-stone-500">Toca el QR para ampliarlo</p>
        </div>
      ) : null}

      {/* Bank data */}
      {ins && (ins.bank_name || ins.account_holder || ins.account_masked) ? (
        <dl className="mt-4 divide-y divide-stone-100 rounded-xl border border-stone-100 px-3">
          <DataRow label="Banco" value={ins.bank_name} />
          <DataRow label="Titular" value={ins.account_holder} />
          <DataRow label="Cuenta" value={ins.account_masked} />
        </dl>
      ) : null}
      {!ins && !data.qr_url ? (
        <p className="mt-4 rounded-xl bg-stone-50 p-3 text-sm text-stone-600">
          Los datos de pago aún no están disponibles. Contáctanos por WhatsApp para recibirlos.
        </p>
      ) : null}

      {/* Reference code for the glosa */}
      {pay?.reference_code ? (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            Código de referencia
          </p>
          <div className="mt-1 flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 font-mono text-sm font-bold text-stone-900">
              {pay.reference_code}
            </p>
            <CopyButton value={pay.reference_code} />
          </div>
          <p className="mt-1.5 text-xs text-stone-600">
            Escríbelo en la <span className="font-semibold">glosa o concepto</span> de la
            transferencia — así encontramos tu pago más rápido.
          </p>
        </div>
      ) : null}

      {ins?.note ? <p className="mt-3 text-xs text-stone-500">{ins.note}</p> : null}
    </section>
  );
}
