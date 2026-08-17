// Read-only: prices and map elements after a reseed.
import { createClient } from '@supabase/supabase-js';
import { loadEnv, requireEnv } from './env';
loadEnv();
const s = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

async function main() {
  const { count: total } = await s.from('lots').select('*', { count: 'exact', head: true }).is('deleted_at', null);
  const { count: conCat } = await s.from('lots').select('*', { count: 'exact', head: true }).is('deleted_at', null).not('category_id', 'is', null);
  const { count: conOverride } = await s.from('lots').select('*', { count: 'exact', head: true }).is('deleted_at', null).not('price_override', 'is', null);
  console.log(`lotes ${total} | con categoria ${conCat} | con precio manual ${conOverride}`);

  const { data: cats } = await s.from('pricing_categories').select('code, name, price_per_m2').order('code');
  for (const c of cats ?? []) console.log(`  cat ${c.code} ${c.name}: ${c.price_per_m2}/m2`);

  const { data: els } = await s.from('map_elements').select('kind, name');
  console.log('map_elements:', (els ?? []).length, (els ?? []).map((e) => `${e.kind}:${e.name ?? ''}`).join(' '));
}
void main();
