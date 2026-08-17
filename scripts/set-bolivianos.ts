// Switch the project to bolivianos and reprice from Terrenalv's own published
// figures.
//
// Run: NODE_OPTIONS=--experimental-websocket npx tsx scripts/set-bolivianos.ts
//
// Flipping projects.currency alone would be dangerous: lot prices are stored as
// a number plus the project currency, so a lot priced 9.000 "USD" silently
// becomes 9.000 "BOB" — a third of its value, and reservable at that price. The
// categories are rewritten in the same run.
//
// The new prices are NOT invented: the flyer the owner supplied as the first
// carousel slide reads "Terreno de 300 m² desde Bs 24.800 al contado", and
// their other material quotes "desde Bs 18.800". Category A is set so a 300 m²
// lot lands exactly on Bs 24.800, and A→E steps down to Bs 18.800, keeping the
// existing spread between categories. Every lot currently carries category A.

import { createClient } from '@supabase/supabase-js';
import { loadEnv, requireEnv } from './env';

loadEnv();
const supabase = createClient(
  requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false } },
);

const SLUG = 'prados-del-sur';

/** Bs per m², chosen so a 300 m² lot lands on the advertised round figure. */
const CATEGORY_BS_PER_M2: Record<string, number> = {
  A: 24800 / 300, // Bs 24.800 — the price on their current flyer
  B: 23000 / 300,
  C: 21500 / 300,
  D: 20000 / 300,
  E: 18800 / 300, // Bs 18.800 — the "desde" in their other material
};

async function main() {
  const { data: project, error: pErr } = await supabase
    .from('projects')
    .select('id, slug, currency')
    .eq('slug', SLUG)
    .single();
  if (pErr || !project) {
    console.error('proyecto no encontrado:', pErr?.message);
    process.exit(1);
  }
  console.log('moneda antes :', project.currency);

  const { error: curErr } = await supabase
    .from('projects')
    .update({ currency: 'BOB' })
    .eq('id', project.id);
  if (curErr) {
    console.error('no se pudo cambiar la moneda:', curErr.message);
    process.exit(1);
  }

  const { data: cats } = await supabase
    .from('pricing_categories')
    .select('id, code, price_per_m2')
    .eq('project_id', project.id);

  for (const c of cats ?? []) {
    const next = CATEGORY_BS_PER_M2[c.code as string];
    if (next === undefined) continue;
    const { error } = await supabase
      .from('pricing_categories')
      .update({ price_per_m2: Number(next.toFixed(4)) })
      .eq('id', c.id);
    if (error) {
      console.error(`categoría ${c.code}:`, error.message);
      process.exit(1);
    }
    console.log(
      `  ${c.code}: ${Number(c.price_per_m2).toFixed(2)} → ${next.toFixed(4)} Bs/m²` +
        `  (300 m² = Bs ${(next * 300).toFixed(0)})`,
    );
  }

  const { data: after } = await supabase
    .from('projects')
    .select('currency')
    .eq('id', project.id)
    .single();
  console.log('moneda después:', after?.currency);
}

void main();
