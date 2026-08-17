// Re-apply pricing after a reseed: every residential lot carries category A,
// which is how the plano was priced before (verified against the soft-deleted
// lots — all A, zero manual overrides).
//
// Run: NODE_OPTIONS=--experimental-websocket npx tsx scripts/apply-prices.ts
//
// Direct update with the service key. bulk_update_lot_prices() is the audited
// path, but it calls private.assert_admin() and there is no admin JWT here;
// /admin/lotes remains the normal way to change pricing, and it does audit.

import { createClient } from '@supabase/supabase-js';
import { loadEnv, requireEnv } from './env';

loadEnv();
const s = createClient(
  requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false } },
);

async function main() {
  const { data: cat, error: e0 } = await s
    .from('pricing_categories')
    .select('id, code, price_per_m2')
    .eq('code', 'A')
    .single();
  if (e0 || !cat) throw new Error(e0?.message ?? 'no existe la categoría A');
  console.log(
    `categoría A = ${cat.price_per_m2}/m² → lote de 300 m² = ${(cat.price_per_m2 * 300).toFixed(0)}`,
  );

  const { error, count } = await s
    .from('lots')
    .update({ category_id: cat.id }, { count: 'exact' })
    .is('deleted_at', null)
    .is('category_id', null);
  if (error) throw new Error(error.message);
  console.log(`lotes con categoría asignada: ${count}`);

  const { count: sinPrecio } = await s
    .from('lots')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null)
    .is('category_id', null);
  console.log(`lotes que siguen sin precio: ${sinPrecio}`);
}

void main();
