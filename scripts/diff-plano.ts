// Read-only: per-manzana lot counts, live plano vs the CAD seed file.
// Run: NODE_OPTIONS=--experimental-websocket npx tsx scripts/diff-plano.ts

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { loadEnv, requireEnv } from './env';

loadEnv();
const s = createClient(
  requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false } },
);

interface SeedMz { code: string; lots: { number: string }[] }

async function main() {
  const seed = JSON.parse(readFileSync('seed/generated-geometry.json', 'utf8')) as {
    manzanas: SeedMz[];
  };
  const seedCount = new Map(seed.manzanas.map((m) => [m.code, (m.lots ?? []).length]));

  // PostgREST caps a response at 1000 rows; the plano has twice that, so page
  // through it or the counts silently stop at exactly 1000.
  const liveCount = new Map<string, number>();
  const liveNumbers = new Map<string, Set<string>>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await s
      .from('lots')
      .select('number, manzanas!inner(code)')
      .is('deleted_at', null)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const l of data ?? []) {
      const code = (l.manzanas as unknown as { code: string }).code;
      liveCount.set(code, (liveCount.get(code) ?? 0) + 1);
      if (!liveNumbers.has(code)) liveNumbers.set(code, new Set());
      liveNumbers.get(code)!.add(String(l.number));
    }
    if (!data || data.length < PAGE) break;
  }
  console.log('lotes vivos leidos:', [...liveCount.values()].reduce((a, b) => a + b, 0));

  let over = 0;
  let under = 0;
  let same = 0;
  const empties: string[] = [];
  for (const [code, want] of seedCount) {
    const have = liveCount.get(code) ?? 0;
    if (have === want) same++;
    else if (have > want) over += have - want;
    else {
      under += want - have;
      if (have === 0) empties.push(code);
    }
  }
  const extraCodes = [...liveCount].filter(([c]) => !seedCount.has(c));
  console.log(`manzanas iguales: ${same}/${seedCount.size}`);
  console.log(`lotes de mas en vivo: ${over} | de menos: ${under}`);
  console.log(`manzanas vacias en vivo pero con lotes en el CAD: ${empties.length}`, empties.join(' '));
  console.log('codigos de manzana que existen en vivo pero no en el seed:', extraCodes.map(([c, n]) => `${c}=${n}`).join(' ') || '(ninguno)');

  // Same count is not the same plano: compare the actual number sets.
  let sameNumbers = 0;
  const numberDiffs: string[] = [];
  for (const m of seed.manzanas) {
    const want = new Set((m.lots ?? []).map((l) => String(l.number)));
    const have = liveNumbers.get(m.code) ?? new Set<string>();
    const missing = [...want].filter((n) => !have.has(n));
    const extra = [...have].filter((n) => !want.has(n));
    if (!missing.length && !extra.length) sameNumbers++;
    else numberDiffs.push(`${m.code}: faltan[${missing.slice(0, 6).join(',')}] sobran[${extra.slice(0, 6).join(',')}]`);
  }
  console.log(`manzanas con los MISMOS numeros que el CAD: ${sameNumbers}/${seed.manzanas.length}`);
  for (const d of numberDiffs.slice(0, 12)) console.log('  ' + d);
}

void main();
