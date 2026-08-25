'use client';

// «Mi plan de pago», del lado del comprador.
//
// La pregunta que la oficina contesta veinte veces por día es siempre la
// misma: ¿cuánto he pagado, cuánto me falta y cuándo vence lo próximo? Acá
// está, sin cuentas ni contraseñas: la llave es su código de seguimiento.
//
// Escrito para que lo entienda cualquiera: una barra de avance, tres cifras
// grandes, y el cronograma con un semáforo por cuota.

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/format';

interface Cuota {
  numero: number;
  vence: string;
  monto: number;
  pagado: number;
  estado: 'pagada' | 'vencida' | 'pendiente' | 'parcial';
  pagada_el: string | null;
}

interface Plan {
  cuota: number;
  meses: number;
  inicial: number;
  financiado: number;
  primer_vencimiento: string;
  cuotas_pagadas: number;
  cuotas_vencidas: number;
  monto_vencido: number;
  proxima: { numero: number; vence: string; monto: number } | null;
  cuotas: Cuota[];
}

interface MiPlan {
  tracking_code: string;
  precio: number;
  pagado: number;
  saldo: number;
  avance_pct: number;
  con_plan: boolean;
  plan: Plan | null;
}

function fecha(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-BO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function MiPlanDePago({ code }: { code: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState<MiPlan | null>(null);
  const [cargado, setCargado] = useState(false);
  const [verTodas, setVerTodas] = useState(false);

  useEffect(() => {
    let vivo = true;
    void supabase.rpc('mi_plan_de_pago', { p_tracking_code: code }).then(({ data: d }) => {
      if (!vivo) return;
      setData((d as MiPlan | null) ?? null);
      setCargado(true);
    });
    return () => {
      vivo = false;
    };
  }, [supabase, code]);

  if (!cargado || !data) return null;

  const p = data.plan;
  const cuotas = p?.cuotas ?? [];
  const visibles = verTodas ? cuotas : cuotas.slice(0, 6);

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h3 className="text-base font-extrabold text-stone-900">Mi plan de pago</h3>

      {/* La barra: de un vistazo, cuánto llevo */}
      <div className="mt-3">
        <div className="h-3 w-full overflow-hidden rounded-full bg-stone-200">
          <div
            className="h-full rounded-full bg-brand transition-all"
            style={{ width: `${Math.min(100, Number(data.avance_pct))}%` }}
          />
        </div>
        <p className="mt-1 text-center text-xs text-stone-500">
          Llevas pagado el <strong>{Number(data.avance_pct)}%</strong> de tu lote
        </p>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-green-50 p-3">
          <p className="text-[11px] text-stone-500">Ya pagaste</p>
          <p className="text-base font-extrabold tabular-nums text-brand">
            {formatMoney(Number(data.pagado), 'BOB')}
          </p>
        </div>
        <div className="rounded-xl bg-stone-50 p-3">
          <p className="text-[11px] text-stone-500">Te falta</p>
          <p className="text-base font-extrabold tabular-nums text-stone-900">
            {formatMoney(Number(data.saldo), 'BOB')}
          </p>
        </div>
        <div className="rounded-xl bg-stone-50 p-3">
          <p className="text-[11px] text-stone-500">Precio del lote</p>
          <p className="text-base font-extrabold tabular-nums text-stone-600">
            {formatMoney(Number(data.precio), 'BOB')}
          </p>
        </div>
      </div>

      {!data.con_plan || !p ? (
        <p className="mt-4 rounded-xl bg-stone-50 p-3 text-sm text-stone-600">
          Tu compra no tiene cuotas fijas: vas abonando cuando puedes y cada pago baja tu saldo.
          Si quieres pasar a un plan de cuotas, escríbenos.
        </p>
      ) : (
        <>
          {p.cuotas_vencidas > 0 ? (
            <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              Tienes <strong>{p.cuotas_vencidas} cuota{p.cuotas_vencidas === 1 ? '' : 's'}</strong>{' '}
              vencida{p.cuotas_vencidas === 1 ? '' : 's'} por{' '}
              <strong>{formatMoney(Number(p.monto_vencido), 'BOB')}</strong>. Ponte al día en la
              oficina o por QR.
            </p>
          ) : p.proxima ? (
            <p className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm text-stone-700">
              Tu próxima cuota (la <strong>N° {p.proxima.numero}</strong>) es de{' '}
              <strong>{formatMoney(Number(p.proxima.monto), 'BOB')}</strong> y vence el{' '}
              <strong>{fecha(p.proxima.vence)}</strong>.
            </p>
          ) : (
            <p className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              ¡No te queda ninguna cuota pendiente!
            </p>
          )}

          <p className="mt-4 text-xs text-stone-500">
            Pagas <strong>{formatMoney(Number(p.cuota), 'BOB')}</strong> por mes ·{' '}
            {p.cuotas_pagadas} de {cuotas.length} cuotas pagadas
          </p>

          <ul className="mt-2 divide-y divide-stone-100 rounded-xl border border-stone-200">
            {visibles.map((c) => (
              <li key={c.numero} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span
                  aria-hidden
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    c.estado === 'pagada'
                      ? 'bg-brand'
                      : c.estado === 'vencida'
                        ? 'bg-red-500'
                        : 'bg-stone-300'
                  }`}
                />
                <span className="w-8 shrink-0 text-xs text-stone-400">N° {c.numero}</span>
                <span className="text-stone-700">
                  {c.estado === 'pagada' && c.pagada_el
                    ? `Pagada el ${fecha(c.pagada_el)}`
                    : `Vence ${fecha(c.vence)}`}
                </span>
                <span
                  className={`ml-auto font-semibold tabular-nums ${
                    c.estado === 'vencida' ? 'text-red-600' : 'text-stone-900'
                  }`}
                >
                  {formatMoney(Number(c.monto), 'BOB')}
                </span>
              </li>
            ))}
          </ul>
          {cuotas.length > 6 ? (
            <button
              type="button"
              onClick={() => setVerTodas((v) => !v)}
              className="mt-2 w-full rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-bold text-stone-600"
            >
              {verTodas ? 'Ver menos' : `Ver las ${cuotas.length} cuotas`}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
