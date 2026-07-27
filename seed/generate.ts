// Generates the day-one map geometry from the transcribed layout spec, using the
// SAME subdivision algorithm as the admin Map Builder. Outputs:
//   seed/generated-geometry.json — consumed by scripts/seed-geometry.ts (DB push)
//   seed/preview.svg             — visual check against the plano photos
// Run: npx tsx seed/generate.ts

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontageSpec, subdivideManzana } from '../src/features/map/lib/subdivide';
import type { Ring } from '../src/features/map/lib/types';
import { BLOCKS, ELEMENTS, UTM_ANCHOR, type BlockSpec, type SideHint } from './layout-spec';

const here = dirname(fileURLToPath(import.meta.url));

const rectRing = ([x, y, w, h]: [number, number, number, number]): Ring => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

/**
 * A point just outside the block on the given side. subdivideManzana uses it to
 * pick which LONG chain is row A (nearest wins), so the hint must sit off a long
 * edge: 'W'/'E' for a tall block, 'S'/'N' for a wide one. Defaulting to 'S' on a
 * tall block leaves both long chains equidistant and the winner arbitrary.
 */
function hintPoint(spec: BlockSpec): [number, number] {
  const [x, y, w, h] = spec.rect;
  const fallback: SideHint = h >= w ? 'W' : 'S';
  switch (spec.hint ?? fallback) {
    case 'S': return [x + w / 2, y - 15];
    case 'N': return [x + w / 2, y + h + 15];
    case 'W': return [x - 15, y + h / 2];
    case 'E': return [x + w + 15, y + h / 2];
  }
}

interface OutManzana {
  code: string;
  sector: string;
  kind: string;
  ring: Ring;
  subdivision_spec: Record<string, unknown> | null;
  needs_review: boolean;
  lots: {
    number: string;
    ring: Ring;
    frontage_m: number;
    depth_m: number;
    area_m2: number;
    is_corner: boolean;
  }[];
}

const manzanas: OutManzana[] = [];
let totalLots = 0;
const allWarnings: string[] = [];

for (const block of BLOCKS) {
  const ring = rectRing(block.rect);
  const out: OutManzana = {
    code: block.code,
    sector: block.sector,
    kind: block.kind,
    ring,
    subdivision_spec: null,
    needs_review: true,
    lots: [],
  };

  if (block.kind === 'residencial' && block.frontA) {
    // The front chain runs along the block's LONG axis, which for this site is
    // vertical (+Y). Using the width unconditionally would mis-size any
    // `llenar xN` spec on a tall block.
    const [, , rw, rh] = block.rect;
    const frontLen = Math.max(rw, rh);
    const frontagesA = parseFrontageSpec(block.frontA, frontLen);
    const frontagesB = block.frontB ? parseFrontageSpec(block.frontB, frontLen) : undefined;
    const rows = block.rows ?? 2;
    const result = subdivideManzana(ring, {
      sideAHint: hintPoint(block),
      rows,
      depthA: block.depthA,
      frontagesA,
      frontagesB,
    });
    out.lots = result.lots;
    out.subdivision_spec = {
      rows,
      depthA: block.depthA ?? null,
      frontA: block.frontA,
      frontB: block.frontB ?? block.frontA,
      hint: block.hint ?? 'S',
    };
    totalLots += result.lots.length;
    for (const w of result.warnings) allWarnings.push(`${block.code}: ${w}`);
    if (Math.abs(result.leftoverA) > 0.3 || Math.abs(result.leftoverB) > 0.3) {
      allWarnings.push(
        `${block.code}: sobrante frente A ${result.leftoverA} m / B ${result.leftoverB} m`,
      );
    }
  }
  manzanas.push(out);
}

const elements = ELEMENTS.map((e) => ({
  kind: e.kind,
  name: e.name,
  ring: rectRing(e.rect),
  props: e.props ?? {},
}));

const geometry = {
  generated_at: new Date().toISOString(),
  utm: UTM_ANCHOR,
  manzanas,
  elements,
};

writeFileSync(join(here, 'generated-geometry.json'), JSON.stringify(geometry));

// ---------------------------------------------------------------------------
// Preview SVG (y flipped: plan-space is y-up, SVG y-down).
// ---------------------------------------------------------------------------
const PAD = 70;
const xs = manzanas.flatMap((m) => m.ring.map((p) => p[0])).concat(elements.flatMap((e) => e.ring.map((p) => p[0])));
const ys = manzanas.flatMap((m) => m.ring.map((p) => p[1])).concat(elements.flatMap((e) => e.ring.map((p) => p[1])));
const minX = Math.min(...xs) - PAD;
const maxX = Math.max(...xs) + PAD;
const minY = Math.min(...ys) - PAD;
const maxY = Math.max(...ys) + PAD;
const W = maxX - minX;
const H = maxY - minY;

const toSvg = (ring: Ring) =>
  ring.map(([x, y], i) => `${i ? 'L' : 'M'}${(x - minX).toFixed(2)} ${(maxY - y).toFixed(2)}`).join('') + 'Z';

const elementFill: Record<string, string> = {
  calle: '#d6d3d1',
  avenida: '#a8a29e',
  ciclovia: '#fcd34d',
  area_verde: '#bbf7d0',
  equipamiento: '#fbcfe8',
  amenidad: '#7dd3fc',
  perimetro: 'none',
};

let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" font-family="sans-serif">`;
svg += `<rect width="${W.toFixed(0)}" height="${H.toFixed(0)}" fill="#f5f5f4"/>`;

for (const e of elements) {
  svg += `<path d="${toSvg(e.ring)}" fill="${elementFill[e.kind] ?? '#eee'}" stroke="none"/>`;
}
for (const m of manzanas) {
  const fill =
    m.kind === 'area_verde'
      ? '#86efac'
      : m.kind === 'equipamiento'
        ? '#f9a8d4'
        : m.kind === 'amenidad'
          ? '#bae6fd'
          : '#ffffff';
  svg += `<path d="${toSvg(m.ring)}" fill="${fill}" stroke="#78716c" stroke-width="0.8"/>`;
  for (const lot of m.lots) {
    svg += `<path d="${toSvg(lot.ring)}" fill="#d9f99d" stroke="#57534e" stroke-width="0.25"/>`;
  }
  const cx = m.ring.reduce((s, p) => s + p[0], 0) / m.ring.length - minX;
  const cy = maxY - m.ring.reduce((s, p) => s + p[1], 0) / m.ring.length;
  svg += `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" font-size="12" font-weight="bold" fill="#44403c">${m.code}</text>`;
}
for (const e of elements.filter((el) => el.kind === 'amenidad' || el.kind === 'avenida')) {
  const cx = e.ring.reduce((s, p) => s + p[0], 0) / e.ring.length - minX;
  const cy = maxY - e.ring.reduce((s, p) => s + p[1], 0) / e.ring.length;
  svg += `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" font-size="8" fill="#1c1917">${e.name}</text>`;
}
svg += '</svg>';
writeFileSync(join(here, 'preview.svg'), svg);

const residencial = manzanas.filter((m) => m.kind === 'residencial');
console.log(`manzanas: ${manzanas.length} (${residencial.length} residenciales)`);
console.log(`lotes: ${totalLots}`);
console.log(`elementos: ${elements.length}`);
for (const m of residencial) {
  const areas = m.lots.map((l) => l.area_m2);
  const min = Math.min(...areas);
  const max = Math.max(...areas);
  console.log(`  ${m.code}: ${m.lots.length} lotes, ${min}–${max} m²`);
}
if (allWarnings.length) {
  console.log('\nADVERTENCIAS:');
  for (const w of allWarnings) console.log('  ' + w);
} else {
  console.log('\nsin advertencias');
}
