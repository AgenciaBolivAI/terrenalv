// Comprobante contable: el papel de un asiento que no tiene otro papel.
//
// El egreso tiene su comprobante, el cobro su recibo y la venta su estado de
// cuenta; pero el activo fijo, el fondo a rendir, el pago a proveedor, la
// compra de terreno y el asiento manual solo existen en el libro. Este papel
// imprime el asiento tal cual está asentado —cuenta por cuenta, con DEBE y
// HABER que cuadran— para que también eso se pueda archivar y firmar.

import { Logo } from '@/components/Logo';
import { formatMoney } from '@/lib/format';

/** Una línea de `v_libro_diario` (solo lo que el papel usa). */
export interface LineaLibro {
  project_id: string;
  fecha: string;
  comprobante: string;
  glosa: string;
  cuenta: string;
  debe: number;
  haber: number;
  origen: string;
  origen_id: string;
  cliente: string | null;
  centro_costo: string | null;
  titular: string | null;
  titular_nombre: string | null;
  registrado_en: string | null;
  usuario: string | null;
  moneda: string | null;
  tipo_cambio: number | null;
  monto_origen: number | null;
}

/** Cómo se muestra una cuenta interna: su código del plan y su nombre. */
export interface CuentaPlan {
  codigo: string;
  nombre: string;
}

// El mismo rótulo que `v_comprobantes` le pone a cada origen, para que el
// papel diga lo mismo que la fila del registro de la que se llegó.
const ROTULO_ORIGEN: Record<string, string> = {
  comprobante: 'Comprobante de diario',
  egreso: 'Comprobante de egreso',
  venta: 'Venta',
  pago: 'Recibo de cobro',
  terreno: 'Compra de terreno',
  activo: 'Activo fijo',
  fondo: 'Fondo a rendir',
  pago_proveedor: 'Pago a proveedor',
};

function fecha(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-BO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/La_Paz',
  });
}

function fechaHora(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-BO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
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

export function ComprobanteAsiento({
  lineas,
  proyecto,
  plan,
}: {
  /** Las líneas del asiento, débitos primero (así se lee un comprobante). */
  lineas: LineaLibro[];
  proyecto: string;
  /** Cuenta interna → código del plan y nombre, resuelto contra `chart_of_accounts`. */
  plan: Record<string, CuentaPlan | undefined>;
}) {
  const cab = lineas[0];
  // Los metadatos vienen repetidos en cada línea; se toma el primero no vacío
  // igual que hace `v_comprobantes`, para no inventar nada nuevo.
  const primero = <K extends keyof LineaLibro>(k: K): LineaLibro[K] | null => {
    for (const l of lineas) if (l[k] !== null && l[k] !== '') return l[k];
    return null;
  };
  const usuario = primero('usuario');
  const registradoEn = primero('registrado_en');
  const centroCosto = primero('centro_costo');
  const titular = primero('titular');
  const titularNombre = primero('titular_nombre');
  const cliente = primero('cliente');
  const moneda = primero('moneda') ?? 'BOB';
  const tipoCambio = Number(primero('tipo_cambio') ?? 1);
  const enOtraMoneda = moneda !== 'BOB' || tipoCambio !== 1;

  const totalDebe = lineas.reduce((s, l) => s + Number(l.debe), 0);
  const totalHaber = lineas.reduce((s, l) => s + Number(l.haber), 0);
  const diferencia = Math.round((totalDebe - totalHaber) * 100) / 100;

  return (
    <article className="rounded-2xl border border-stone-200 bg-white p-8 print:rounded-none print:border-0 print:p-0">
      <header className="flex items-start justify-between gap-4 border-b-2 border-brand pb-4">
        <div>
          <Logo className="h-9 w-auto" />
          <p className="mt-2 text-sm text-stone-600">TERRENALV S.R.L. · {proyecto}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold tracking-wide text-stone-500 uppercase">
            {ROTULO_ORIGEN[cab.origen] ?? 'Comprobante contable'}
          </p>
          <p className="font-mono text-lg font-bold text-stone-900">{cab.comprobante}</p>
          <p className="text-sm text-stone-500">{fecha(cab.fecha)}</p>
        </div>
      </header>

      <section className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4">
        <Dato rotulo="Glosa">{cab.glosa}</Dato>
        <Dato rotulo="Registrado">
          {fechaHora(registradoEn)}
          {usuario ? <span className="block text-xs text-stone-500">por {usuario}</span> : null}
        </Dato>
        <Dato rotulo="Centro de costos">{centroCosto ?? 'Sin centro asignado'}</Dato>
        <Dato rotulo="A nombre de">
          {titular === 'tercero' ? (
            <>
              <strong>{titularNombre}</strong>
              <span className="block text-xs text-amber-700">Un tercero — no es de la empresa</span>
            </>
          ) : (
            'Terrenalv S.R.L.'
          )}
        </Dato>
        {cliente ? <Dato rotulo="Cliente">{cliente}</Dato> : null}
        {enOtraMoneda ? (
          <Dato rotulo="Moneda">
            {moneda} al tipo de cambio {tipoCambio.toLocaleString('es-BO')}
            <span className="block text-xs text-stone-500">
              El asiento está expresado en bolivianos.
            </span>
          </Dato>
        ) : null}
      </section>

      {/* El cuerpo es el asiento mismo, línea por línea como está en el libro. */}
      <section className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-stone-300 bg-stone-50 text-left">
              <th className="px-3 py-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">
                Cuenta
              </th>
              <th className="px-3 py-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">
                Glosa
              </th>
              <th className="px-3 py-2 text-right text-xs font-semibold tracking-wide text-stone-500 uppercase">
                Debe
              </th>
              <th className="px-3 py-2 text-right text-xs font-semibold tracking-wide text-stone-500 uppercase">
                Haber
              </th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => {
              const cuenta = plan[l.cuenta];
              return (
                <tr key={`${l.cuenta}-${i}`} className="border-b border-stone-100">
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <span className="font-mono text-xs font-semibold text-stone-700">
                      {cuenta?.codigo ?? l.cuenta}
                    </span>
                    {cuenta ? (
                      <span className="block text-xs text-stone-500">{cuenta.nombre}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-1.5 text-stone-800">{l.glosa}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-stone-800">
                    {Number(l.debe) ? formatMoney(Number(l.debe), 'BOB') : ''}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-stone-800">
                    {Number(l.haber) ? formatMoney(Number(l.haber), 'BOB') : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-stone-300 font-semibold">
              <td className="px-3 py-2 text-xs text-stone-500" colSpan={2}>
                Totales
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-stone-900">
                {formatMoney(totalDebe, 'BOB')}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-stone-900">
                {formatMoney(totalHaber, 'BOB')}
              </td>
            </tr>
          </tfoot>
        </table>
        {diferencia !== 0 ? (
          // Un asiento descuadrado no debería existir; si llega a imprimirse,
          // que lo diga a gritos en vez de pasar por un papel válido.
          <p className="mt-2 text-right text-xs font-semibold text-red-700">
            Asiento descuadrado: diferencia de {formatMoney(Math.abs(diferencia), 'BOB')}.
          </p>
        ) : null}
      </section>

      {/* Las firmas son lo que vuelve esto un respaldo. */}
      <section className="mt-14 grid grid-cols-3 gap-8">
        {['Elaborado por', 'Autorizado por', 'Recibí conforme'].map((f, i) => (
          <div key={f} className="text-center">
            <div className="border-t border-stone-400 pt-1.5">
              <p className="text-[11px] tracking-wide text-stone-500 uppercase">{f}</p>
              {i === 0 && usuario ? (
                <p className="mt-0.5 text-xs text-stone-400">{usuario}</p>
              ) : null}
            </div>
          </div>
        ))}
      </section>

      <footer className="mt-8 border-t border-stone-200 pt-3 text-center text-[11px] text-stone-400">
        Comprobante contable emitido por el sistema de Terrenalv S.R.L. · {cab.comprobante} ·{' '}
        {fecha(cab.fecha)}. No constituye factura.
      </footer>
    </article>
  );
}
