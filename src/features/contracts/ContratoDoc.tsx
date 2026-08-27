import { formatMoney } from '@/lib/format';
import { Logo } from '@/components/Logo';
import type { ContratoData } from './contrato';

// El papel del contrato — compartido por el panel y por la página del
// comprador, como el recibo: un solo papel, dos puertas.
//
// Dos documentos distintos según el caso:
//   * COMPRAVENTA: Terrenalv vende el lote al comprador.
//   * TRASPASO: el comprador anterior cede su compra; lo pagado queda a favor
//     del nuevo, que asume el saldo. Si vino del mercado, el precio pactado y
//     la comisión quedan escritos.
//
// Es un BORRADOR generado desde el sistema para revisar y firmar en oficina:
// siempre refleja la base al día — traspasada la venta, el contrato del nuevo
// nace solo y el del anterior sale marcado ANULADO.

function fechaLarga(iso: string | null): string {
  if (!iso) return '—';
  // Una fecha suelta ('2026-09-27') se lee como medianoche UTC, y en La Paz
  // (UTC−4) eso cae el día ANTERIOR: el contrato fechaba la primera cuota el
  // 26 mientras el cronograma decía 27. Se ancla al mediodía, como el resto
  // del sistema, para que ningún huso la corra.
  const d = iso.length <= 10 ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return d.toLocaleDateString('es-BO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/La_Paz',
  });
}

export function Contrato({ c }: { c: ContratoData }) {
  const esTraspaso = c.tipo === 'traspaso';
  return (
    <article className="relative rounded-xl border border-stone-300 bg-white p-8 text-[15px] leading-relaxed text-stone-800 shadow-sm print:border-0 print:shadow-none">
      {c.anulada ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="-rotate-12 rounded border-4 border-red-300 px-6 py-2 text-4xl font-black tracking-widest text-red-300">
            ANULADO
          </p>
        </div>
      ) : null}

      <header className="flex items-start justify-between gap-4 border-b border-stone-300 pb-4">
        <div>
          <Logo className="h-9 w-auto" />
          <p className="mt-1.5 text-xs text-stone-500">
            TERRENALV S.R.L. · Zanja Honda, Santa Cruz
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
            {esTraspaso
              ? 'Contrato privado de cesión de derechos (traspaso)'
              : 'Contrato privado de compraventa de lote'}
          </p>
          <p className="font-mono text-sm font-bold text-stone-900">N° {c.tracking_code}</p>
          <p className="text-xs text-stone-500">{fechaLarga(c.fecha)}</p>
        </div>
      </header>

      {c.anulada && c.cedida_a ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Este contrato quedó <strong>sin efecto</strong>: la compra fue cedida a{' '}
          <strong>{c.cedida_a.comprador}</strong> bajo el contrato{' '}
          <span className="font-mono font-bold">{c.cedida_a.tracking}</span>. Los pagos y recibos
          emitidos bajo este número conservan su validez histórica a nombre de quien los hizo.
        </p>
      ) : null}
      {c.anulada && !c.cedida_a ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Este contrato quedó <strong>sin efecto</strong> por anulación de la venta.
        </p>
      ) : null}

      {/* ---- Partes ---- */}
      <section className="mt-5">
        <h2 className="text-xs font-bold tracking-wide text-stone-500 uppercase">Partes</h2>
        <p className="mt-1">
          <strong>TERRENALV S.R.L.</strong>, en adelante «LA VENDEDORA», propietaria del inmueble
          objeto de este contrato;
          {esTraspaso && c.traspaso ? (
            <>
              {' '}
              <strong>{c.traspaso.de_comprador}</strong>, con C.I. {c.traspaso.de_ci}, en adelante
              «EL CEDENTE», comprador original bajo el contrato{' '}
              <span className="font-mono">{c.traspaso.de_tracking}</span>;
            </>
          ) : null}{' '}
          y <strong>{c.buyer_full_name}</strong>, con C.I. {c.buyer_ci}, teléfono {c.buyer_phone}
          {c.buyer_email ? `, correo ${c.buyer_email}` : ''}, en adelante{' '}
          {esTraspaso ? '«EL CESIONARIO»' : '«EL COMPRADOR»'}.
        </p>
      </section>

      {/* ---- Objeto ---- */}
      <section className="mt-4">
        <h2 className="text-xs font-bold tracking-wide text-stone-500 uppercase">Objeto</h2>
        <p className="mt-1">
          El lote <strong>N° {c.lote ?? '—'}</strong> de la manzana{' '}
          <strong>{c.manzana ?? '—'}</strong>, urbanización <strong>{c.proyecto}</strong>
          {c.area_m2 !== null ? (
            <>
              , con una superficie de <strong>{c.area_m2.toFixed(2)} m²</strong>
            </>
          ) : null}
          {c.frontage_m !== null && c.depth_m !== null
            ? ` (frente ${c.frontage_m} m × fondo ${c.depth_m} m)`
            : ''}
          .
        </p>
      </section>

      {/* ---- Antecedentes del traspaso ---- */}
      {esTraspaso && c.traspaso ? (
        <section className="mt-4">
          <h2 className="text-xs font-bold tracking-wide text-stone-500 uppercase">
            Antecedentes de la cesión
          </h2>
          <p className="mt-1">
            EL CEDENTE adquirió el lote bajo el contrato{' '}
            <span className="font-mono">{c.traspaso.de_tracking}</span> y cede sus derechos con la
            autorización de LA VENDEDORA. Al momento de la cesión llevaba pagados{' '}
            <strong>{formatMoney(c.traspaso.pagado_arrastrado, 'BOB')}</strong>, importe que queda
            íntegramente <strong>a favor de EL CESIONARIO</strong>, quien asume el saldo pendiente
            de <strong>{formatMoney(c.traspaso.saldo_arrastrado, 'BOB')}</strong> con LA VENDEDORA.
          </p>
          {c.traspaso.mercado ? (
            <p className="mt-1">
              La cesión se pactó a través del mercado de traspasos de LA VENDEDORA por un precio
              entre partes de{' '}
              <strong>{formatMoney(c.traspaso.mercado.precio, 'BOB')}</strong>, pagado por EL
              CESIONARIO a EL CEDENTE. EL CEDENTE cubrió la comisión del servicio (
              {c.traspaso.mercado.comision_pct}%:{' '}
              {formatMoney(c.traspaso.mercado.comision_bob, 'BOB')}), con recibo emitido.
            </p>
          ) : null}
          {c.traspaso.motivo ? (
            <p className="mt-1 text-sm text-stone-600">Motivo declarado: {c.traspaso.motivo}.</p>
          ) : null}
        </section>
      ) : null}

      {/* ---- Precio y forma de pago ---- */}
      <section className="mt-4">
        <h2 className="text-xs font-bold tracking-wide text-stone-500 uppercase">
          Precio y forma de pago
        </h2>
        <p className="mt-1">
          El precio del lote es de <strong>{formatMoney(c.precio, 'BOB')}</strong>.
          {c.sena_pagada > 0
            ? ` La seña de ${formatMoney(c.sena_pagada, 'BOB')} entregada al reservar se aplica al precio.`
            : ''}
        </p>
        {c.plan ? (
          <p className="mt-1">
            {esTraspaso ? 'EL CESIONARIO' : 'EL COMPRADOR'} paga una cuota inicial de{' '}
            <strong>{formatMoney(c.plan.cuota_inicial, 'BOB')}</strong> y el resto en{' '}
            <strong>{c.plan.months} cuotas mensuales</strong> de{' '}
            <strong>{formatMoney(c.plan.monthly_amount, 'BOB')}</strong>, la primera con
            vencimiento el {fechaLarga(c.plan.first_due_date)}.
          </p>
        ) : (
          <p className="mt-1">
            {esTraspaso
              ? 'Las condiciones de pago del saldo se pactan con LA VENDEDORA; mientras no se acuerde un plan de cuotas, el saldo se cancela mediante abonos.'
              : 'El pago se realiza al contado o mediante abonos acordados con LA VENDEDORA.'}
          </p>
        )}
        <div className="mt-2 grid grid-cols-2 gap-3 rounded-lg bg-stone-50 p-3 text-sm print:ring-1 print:ring-stone-300">
          <div>
            <p className="text-xs text-stone-500">Pagado a la fecha de emisión</p>
            <p className="font-bold tabular-nums">{formatMoney(c.pagado_total, 'BOB')}</p>
          </div>
          <div>
            <p className="text-xs text-stone-500">Saldo pendiente</p>
            <p className="font-bold tabular-nums">{formatMoney(c.saldo, 'BOB')}</p>
          </div>
        </div>
      </section>

      {/* ---- Dominio ---- */}
      <section className="mt-4">
        <h2 className="text-xs font-bold tracking-wide text-stone-500 uppercase">
          Reserva de dominio
        </h2>
        <p className="mt-1">
          LA VENDEDORA conserva la propiedad del lote hasta la cancelación total del precio. Toda
          cesión o traspaso de los derechos de este contrato requiere la autorización de LA
          VENDEDORA y se formaliza en sus oficinas.
        </p>
      </section>

      {/* ---- Firmas ---- */}
      <section className="mt-10 grid grid-cols-2 gap-8 text-center text-sm sm:grid-cols-3">
        <div>
          <div className="border-t border-stone-400 pt-2">LA VENDEDORA</div>
          <p className="text-xs text-stone-500">Terrenalv S.R.L.</p>
        </div>
        {esTraspaso && c.traspaso ? (
          <div>
            <div className="border-t border-stone-400 pt-2">EL CEDENTE</div>
            <p className="text-xs text-stone-500">
              {c.traspaso.de_comprador} · C.I. {c.traspaso.de_ci}
            </p>
          </div>
        ) : null}
        <div>
          <div className="border-t border-stone-400 pt-2">
            {esTraspaso ? 'EL CESIONARIO' : 'EL COMPRADOR'}
          </div>
          <p className="text-xs text-stone-500">
            {c.buyer_full_name} · C.I. {c.buyer_ci}
          </p>
        </div>
      </section>

      <footer className="mt-8 border-t border-stone-200 pt-4 text-xs text-stone-500">
        <p>
          Borrador generado por el sistema de Terrenalv S.R.L. a partir de los datos vigentes de la
          venta <span className="font-mono">{c.tracking_code}</span>, para revisión y firma en
          oficina. Las cifras de pagos y saldo corresponden a la fecha de emisión.
        </p>
      </footer>
    </article>
  );
}
