'use client';

// Gráficos de la analítica, en SVG a mano.
//
// Sin librería: el proyecto ya dibuja el plano completo en SVG, y sumar una
// dependencia de gráficos por cuatro formas sería peso que se descarga en cada
// visita al panel.
//
// Reglas que se siguen en todos (no son gusto, son legibilidad):
//   * marcas finas, extremos redondeados de 4px anclados a la base;
//   * 2px de separación entre rellenos contiguos, para que dos barras apiladas
//     no se lean como una sola;
//   * grilla y ejes recesivos — los datos van adelante, la grilla atrás;
//   * el texto usa colores de texto, nunca el color de la serie: el cuadradito
//     de color al lado ya lleva la identidad;
//   * tooltip al pasar por encima en todos, porque un gráfico en pantalla que
//     no se puede interrogar obliga a leer el valor "a ojo" desde el eje;
//   * un solo eje. Dos escalas en el mismo dibujo hacen que dos series se
//     crucen donde no se cruzan.

import { useId, useState } from 'react';

export const SERIES = ['var(--an-1)', 'var(--an-2)', 'var(--an-3)', 'var(--an-4)', 'var(--an-5)', 'var(--an-6)'];

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / mag) * mag;
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5 text-xs text-stone-600">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
            style={{ backgroundColor: it.color }}
          />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

export function EmptyChart({ msg }: { msg: string }) {
  return <p className="py-10 text-center text-sm text-stone-400">{msg}</p>;
}

/* ========================================================================== */
/* Barras verticales agrupadas por período                                     */
/* ========================================================================== */

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
}

export function GroupedBars({
  data,
  series,
  format = (n: number) => String(n),
  height = 220,
}: {
  data: { label: string; values: Record<string, number> }[];
  series: SeriesDef[];
  format?: (n: number) => string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId();
  if (!data.length) return <EmptyChart msg="Sin datos en este período." />;

  const max = niceMax(Math.max(1, ...data.flatMap((d) => series.map((s) => d.values[s.key] ?? 0))));
  const W = 720;
  const H = height;
  const padL = 48;
  const padB = 26;
  const padT = 8;
  const plotW = W - padL - 8;
  const plotH = H - padB - padT;
  const groupW = plotW / data.length;
  // 2px de aire entre barras contiguas; el resto se reparte entre las series.
  const barW = Math.max(3, (groupW - 10) / series.length - 2);

  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-labelledby={`${uid}-t`}>
        <title id={`${uid}-t`}>
          {series.map((s) => s.label).join(', ')} por período
        </title>

        {/* Grilla al fondo, apenas visible. */}
        {ticks.map((t) => {
          const y = padT + plotH - (t / max) * plotH;
          return (
            <g key={t}>
              <line x1={padL} x2={W - 8} y1={y} y2={y} stroke="var(--an-grid)" strokeWidth={1} />
              <text x={padL - 8} y={y + 4} textAnchor="end" className="fill-stone-500" fontSize={11}>
                {format(t)}
              </text>
            </g>
          );
        })}

        {data.map((d, i) => {
          const gx = padL + i * groupW;
          return (
            <g
              key={d.label}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {/* Zona sensible del ancho del grupo: apuntar a una barra de 6px
                  con el mouse es una prueba de puntería, no una interfaz. */}
              <rect
                x={gx}
                y={padT}
                width={groupW}
                height={plotH}
                fill={hover === i ? 'var(--an-grid)' : 'transparent'}
                opacity={hover === i ? 0.45 : 0}
              />
              {series.map((s, si) => {
                const v = d.values[s.key] ?? 0;
                const h = (v / max) * plotH;
                return (
                  <rect
                    key={s.key}
                    x={gx + 5 + si * (barW + 2)}
                    y={padT + plotH - h}
                    width={barW}
                    height={Math.max(v > 0 ? 2 : 0, h)}
                    rx={Math.min(4, barW / 2)}
                    fill={s.color}
                  />
                );
              })}
              <text
                x={gx + groupW / 2}
                y={H - 8}
                textAnchor="middle"
                className="fill-stone-500"
                fontSize={11}
              >
                {d.label}
              </text>
            </g>
          );
        })}
        <line x1={padL} x2={W - 8} y1={padT + plotH} y2={padT + plotH} stroke="var(--an-axis)" strokeWidth={1} />
      </svg>

      {hover !== null ? (
        <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs shadow-lg">
          <p className="font-semibold text-stone-800">{data[hover].label}</p>
          {series.map((s) => (
            <p key={s.key} className="mt-0.5 flex items-center gap-1.5 text-stone-600">
              <span aria-hidden="true" className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: s.color }} />
              {s.label}: <strong className="tabular-nums">{format(data[hover].values[s.key] ?? 0)}</strong>
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ========================================================================== */
/* Barras horizontales para rankings                                           */
/* ========================================================================== */

export function RankBars({
  rows,
  format = (n: number) => String(n),
  color = 'var(--an-1)',
  max: maxOverride,
}: {
  rows: { label: string; value: number; hint?: string }[];
  format?: (n: number) => string;
  color?: string;
  max?: number;
}) {
  if (!rows.length) return <EmptyChart msg="Sin datos." />;
  const max = niceMax(maxOverride ?? Math.max(1, ...rows.map((r) => r.value)));

  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.label} className="group flex items-center gap-3 text-sm">
          <span className="w-24 shrink-0 truncate text-stone-600" title={r.label}>
            {r.label}
          </span>
          <span className="relative h-4 flex-1 overflow-hidden rounded bg-stone-100">
            <span
              className="absolute inset-y-0 left-0 rounded"
              style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%`, backgroundColor: color }}
            />
          </span>
          <span className="w-24 shrink-0 text-right tabular-nums font-semibold text-stone-800">
            {format(r.value)}
          </span>
          {r.hint ? <span className="w-20 shrink-0 text-right text-xs text-stone-400">{r.hint}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/* ========================================================================== */
/* Barra apilada de una sola fila (composición: embudo, aging)                  */
/* ========================================================================== */

export function StackedRow({
  parts,
  format = (n: number) => String(n),
}: {
  parts: { label: string; value: number; color: string }[];
  format?: (n: number) => string;
}) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total <= 0) return <EmptyChart msg="Sin datos." />;

  return (
    <div>
      {/* gap-0.5 son los 2px de aire entre segmentos: sin eso, dos tramos
          contiguos de colores parecidos se leen como uno solo. */}
      <div className="flex h-7 gap-0.5 overflow-hidden rounded-lg">
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <div
              key={p.label}
              title={`${p.label}: ${format(p.value)}`}
              style={{ width: `${(p.value / total) * 100}%`, backgroundColor: p.color }}
              className="first:rounded-l-lg last:rounded-r-lg"
            />
          ))}
      </div>
      <ul className="mt-3 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2 text-xs">
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: p.color }} />
            <span className="text-stone-600">{p.label}</span>
            <span className="ml-auto tabular-nums font-semibold text-stone-800">{format(p.value)}</span>
            <span className="w-10 text-right tabular-nums text-stone-400">
              {Math.round((p.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
