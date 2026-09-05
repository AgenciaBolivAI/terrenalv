'use client';

// Selector de período: atajos de siempre más dos fechas a mano.
//
// El rango vive en la URL (?desde=&hasta=) y no en el estado del componente,
// por tres razones: el tablero es un componente de servidor y así puede leer el
// período sin volverse cliente; el enlace queda compartible («mirá las ventas
// de ayer»); y al abrir una casilla se le puede pasar el MISMO rango a la
// pantalla de destino, que es lo que hace que el número y la lista coincidan.

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { hoyBolivia, laPazDateOf } from '@/features/admin/lib/lapaz';
import { useCallback } from 'react';

// El día que cuenta es el de Bolivia: hoyBolivia() vive en lib/lapaz.ts y es
// la misma que usan los formularios, para que «Hoy» signifique lo mismo en
// todas partes.
function hace(dias: number): string {
  return laPazDateOf(new Date(Date.now() - dias * 86_400_000));
}

function inicioDeMes(): string {
  return `${hoyBolivia().slice(0, 7)}-01`;
}

type Atajo = { label: string; desde: string | null; hasta: string | null };

function atajos(): Atajo[] {
  const hoy = hoyBolivia();
  return [
    { label: 'Hoy', desde: hoy, hasta: hoy },
    { label: 'Ayer', desde: hace(1), hasta: hace(1) },
    { label: '7 días', desde: hace(6), hasta: hoy },
    { label: '30 días', desde: hace(29), hasta: hoy },
    { label: 'Este mes', desde: inicioDeMes(), hasta: hoy },
    { label: 'Todo', desde: null, hasta: null },
  ];
}

export function RangoFechas({ desde, hasta }: { desde: string | null; hasta: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const ir = useCallback(
    (d: string | null, h: string | null) => {
      const p = new URLSearchParams(params.toString());
      if (d) p.set('desde', d);
      else p.delete('desde');
      if (h) p.set('hasta', h);
      else p.delete('hasta');
      const q = p.toString();
      router.push(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [router, pathname, params],
  );

  const activo = (a: Atajo) => a.desde === desde && a.hasta === hasta;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2">
      <span className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Período</span>
      <div className="flex flex-wrap gap-1">
        {atajos().map((a) => (
          <button
            key={a.label}
            type="button"
            aria-pressed={activo(a)}
            onClick={() => ir(a.desde, a.hasta)}
            className={`cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors
                        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-light ${
                          activo(a)
                            ? 'bg-brand text-white'
                            : 'bg-stone-100 text-stone-600 hover:bg-stone-200 hover:text-stone-900'
                        }`}
          >
            {a.label}
          </button>
        ))}
      </div>

      <span className="ml-2 text-xs text-stone-400">o a mano</span>
      <input
        type="date"
        value={desde ?? ''}
        max={hasta ?? undefined}
        onChange={(e) => ir(e.target.value || null, hasta)}
        aria-label="Desde"
        className="rounded-lg border border-stone-300 px-2 py-1 text-xs text-stone-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-light"
      />
      <span className="text-xs text-stone-400">a</span>
      <input
        type="date"
        value={hasta ?? ''}
        min={desde ?? undefined}
        onChange={(e) => ir(desde, e.target.value || null)}
        aria-label="Hasta"
        className="rounded-lg border border-stone-300 px-2 py-1 text-xs text-stone-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-light"
      />
    </div>
  );
}
