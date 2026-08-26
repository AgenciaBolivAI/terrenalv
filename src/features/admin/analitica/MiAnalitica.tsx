'use client';

// La analítica de UN vendedor: sus ventas, su plata, sus meses.
//
// Cuando el acceso a analítica es «propia», esta pantalla reemplaza a la de
// la empresa. El filtro no es cosmético: mi_analitica() corre en la base y
// solo mira las ventas con sold_by = quien pregunta — no hay forma de pedirle
// los números de otro.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/format';
import { Kpi, Spinner, EmptyState } from '@/features/admin/ui/bits';
import { mesCorto } from './types';

interface Mes {
  mes: string;
  ventas: number;
  monto: number;
}

interface MiAnalyticsData {
  ventas: number;
  reservas_vivas: number;
  valor_vendido: number;
  cobrado: number;
  comision_ganada: number;
  comision_pagada: number;
  por_mes: Mes[];
}

export default function MiAnalitica() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  // Toda ficha lleva a los registros que cuenta: el detalle vive en Mi cuenta.
  const alDetalle = () => router.push('/admin/mi-cuenta');
  const [d, setD] = useState<MiAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  const cargar = useCallback(async () => {
    const { data } = await supabase.rpc('mi_analitica');
    setD((data as MiAnalyticsData | null) ?? null);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (!d || (d.ventas === 0 && d.reservas_vivas === 0)) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-lg font-bold text-stone-900">Mi analítica</h1>
        <div className="mt-4">
          <EmptyState
            title="Todavía no tenés ventas asignadas"
            hint="Cuando cierres una venta o tomes una reserva, tus números aparecen acá."
          />
        </div>
      </div>
    );
  }

  const meses = d.por_mes ?? [];
  const maxMonto = Math.max(1, ...meses.map((m) => Number(m.monto)));
  const porCobrar = Math.max(0, Number(d.comision_ganada) - Number(d.comision_pagada));

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-lg font-bold text-stone-900">Mi analítica</h1>
        <p className="text-xs text-stone-500">Tus ventas y tu comisión. Solo lo tuyo.</p>
        <Link
          href="/admin/mi-cuenta"
          className="ml-auto text-xs font-semibold text-brand hover:underline"
        >
          Ver el detalle en Mi cuenta →
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Ventas cerradas" value={String(d.ventas)} hint="asignadas a tu nombre" onClick={alDetalle} />
        <Kpi
          label="Valor vendido"
          value={formatMoney(Number(d.valor_vendido), 'BOB')}
          tone="good"
          hint="precio pactado de tus ventas"
          onClick={alDetalle}
        />
        <Kpi
          label="Cobrado de tus ventas"
          value={formatMoney(Number(d.cobrado), 'BOB')}
          hint="capital que ya entró"
          onClick={alDetalle}
        />
        <Kpi
          label="Comisión por cobrar"
          value={formatMoney(porCobrar, 'BOB')}
          tone={porCobrar > 0 ? 'bad' : 'normal'}
          hint={`ganada ${formatMoney(Number(d.comision_ganada), 'BOB')} · pagada ${formatMoney(Number(d.comision_pagada), 'BOB')}`}
          onClick={alDetalle}
        />
      </div>

      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
          Tus ventas por mes
        </p>
        {meses.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">Sin ventas cerradas todavía.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {meses.map((m) => (
              <div key={m.mes} className="flex items-center gap-3 text-sm">
                <span className="w-16 shrink-0 text-xs text-stone-500">{mesCorto(m.mes)}</span>
                <div className="h-5 flex-1 overflow-hidden rounded bg-stone-100">
                  <div
                    className="h-full rounded bg-brand/80"
                    style={{ width: `${Math.max(3, (Number(m.monto) / maxMonto) * 100)}%` }}
                  />
                </div>
                <span className="w-28 shrink-0 text-right text-xs tabular-nums text-stone-600">
                  {formatMoney(Number(m.monto), 'BOB')}
                </span>
                <span className="w-16 shrink-0 text-right text-xs text-stone-400">
                  {m.ventas} venta{m.ventas === 1 ? '' : 's'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
