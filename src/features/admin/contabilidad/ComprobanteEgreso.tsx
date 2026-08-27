// Comprobante de egreso: el papel que respalda que salió plata.
//
// Un egreso sin comprobante es una salida de caja que nadie firmó. Este papel
// dice qué se pagó, a quién, de qué caja salió, contra qué cuenta contable, a
// qué centro de costos carga y a nombre de quién está — y tiene las firmas al
// pie, que es lo que lo vuelve un respaldo y no una impresión.

import { Logo } from '@/components/Logo';
import { formatMoney } from '@/lib/format';

export interface EgresoDoc {
  id: string;
  numero: string;
  fecha: string;
  proyecto: string;
  detalle: string;
  nota: string | null;
  amount: number;
  currency: string;
  amount_bob: number;
  concepto: string | null;
  concepto_codigo: string | null;
  cuenta_codigo: string;
  cuenta_nombre: string | null;
  proveedor: string | null;
  proveedor_nit: string | null;
  pagado_de: string | null;
  centro_costo: string | null;
  centro_costo_codigo: string | null;
  titular: string;
  titular_nombre: string | null;
  tracking_code: string | null;
  cliente: string | null;
  cargado_por: string | null;
}

function fecha(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-BO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/La_Paz',
  });
}

function Dato({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] tracking-wide text-stone-500 uppercase">{rotulo}</p>
      <p className="mt-0.5 text-sm text-stone-900">{children}</p>
    </div>
  );
}

export function ComprobanteEgreso({ e }: { e: EgresoDoc }) {
  return (
    <article className="rounded-2xl border border-stone-200 bg-white p-8 print:rounded-none print:border-0 print:p-0">
      <header className="flex items-start justify-between gap-4 border-b-2 border-brand pb-4">
        <div>
          <Logo className="h-9 w-auto" />
          <p className="mt-2 text-sm text-stone-600">
            TERRENALV S.R.L. · {e.proyecto}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold tracking-wide text-stone-500 uppercase">
            Comprobante de egreso
          </p>
          <p className="font-mono text-lg font-bold text-stone-900">{e.numero}</p>
          <p className="text-sm text-stone-500">{fecha(e.fecha)}</p>
        </div>
      </header>

      <section className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4">
        <Dato rotulo="Pagado a">
          <strong>{e.proveedor ?? '—'}</strong>
          {e.proveedor_nit ? (
            <span className="block text-xs text-stone-500">NIT / CI {e.proveedor_nit}</span>
          ) : null}
        </Dato>
        <Dato rotulo="Salió de">
          {e.pagado_de ?? 'Sin caja asignada'}
        </Dato>
        <Dato rotulo="Concepto">
          {e.concepto ?? '—'}
          {e.concepto_codigo ? (
            <span className="block font-mono text-xs text-stone-400">{e.concepto_codigo}</span>
          ) : null}
        </Dato>
        <Dato rotulo="Cuenta contable">
          <span className="font-mono">{e.cuenta_codigo}</span>{' '}
          {e.cuenta_nombre ? `· ${e.cuenta_nombre}` : ''}
        </Dato>
        <Dato rotulo="Centro de costos">
          {e.centro_costo
            ? `${e.centro_costo_codigo ? `${e.centro_costo_codigo} · ` : ''}${e.centro_costo}`
            : 'Sin centro asignado'}
        </Dato>
        <Dato rotulo="A nombre de">
          {e.titular === 'tercero' ? (
            <>
              <strong>{e.titular_nombre}</strong>
              <span className="block text-xs text-amber-700">
                Un tercero — no es de la empresa
              </span>
            </>
          ) : (
            'Terrenalv S.R.L.'
          )}
        </Dato>
      </section>

      <section className="mt-6 rounded-xl bg-stone-50 p-4">
        <p className="text-[11px] tracking-wide text-stone-500 uppercase">Detalle</p>
        <p className="mt-1 text-base text-stone-900">{e.detalle}</p>
        {e.tracking_code ? (
          <p className="mt-1 text-xs text-stone-500">
            Corresponde a la venta {e.tracking_code}
            {e.cliente ? ` — ${e.cliente}` : ''}
          </p>
        ) : null}
        {e.nota ? <p className="mt-2 text-sm text-stone-600">{e.nota}</p> : null}

        <div className="mt-4 flex items-end justify-between border-t border-stone-200 pt-3">
          <p className="text-sm text-stone-500">Importe</p>
          <p className="text-2xl font-bold tabular-nums text-stone-900">
            {formatMoney(Number(e.amount_bob), 'BOB')}
          </p>
        </div>
        {e.currency !== 'BOB' ? (
          <p className="mt-1 text-right text-xs text-stone-500">
            Pagado en {e.currency} {Number(e.amount).toLocaleString('es-BO')} — convertido al tipo
            de cambio del día.
          </p>
        ) : null}
      </section>

      {/* Las firmas son lo que vuelve esto un respaldo. */}
      <section className="mt-14 grid grid-cols-3 gap-8">
        {['Elaborado por', 'Autorizado por', 'Recibí conforme'].map((f, i) => (
          <div key={f} className="text-center">
            <div className="border-t border-stone-400 pt-1.5">
              <p className="text-[11px] tracking-wide text-stone-500 uppercase">{f}</p>
              {i === 0 && e.cargado_por ? (
                <p className="mt-0.5 text-xs text-stone-400">{e.cargado_por}</p>
              ) : null}
              {i === 2 && e.proveedor ? (
                <p className="mt-0.5 text-xs text-stone-400">{e.proveedor}</p>
              ) : null}
            </div>
          </div>
        ))}
      </section>

      <footer className="mt-8 border-t border-stone-200 pt-3 text-center text-[11px] text-stone-400">
        Comprobante de egreso emitido por el sistema de Terrenalv S.R.L. · {e.numero} ·{' '}
        {fecha(e.fecha)}. No constituye factura.
      </footer>
    </article>
  );
}
