// Reprecia el proyecto para que el lote MÁS BARATO quede en un monto dado.
//
// Run: NODE_OPTIONS=--experimental-websocket npx tsx scripts/set-precio-contado.ts 29999
//
// Los lotes no miden todos igual (244 a 714 m²), así que "desde Bs X" no es un
// precio que se escriba: es una consecuencia del precio por m² aplicado al lote
// más chico. Este script hace la cuenta al revés — parte del piso que se quiere
// publicar y despeja el Bs/m² — para que la landing muestre exactamente esa
// cifra y no una aproximación.
//
// Mantiene la escalera entre categorías: A..E conservan su proporción, aunque
// hoy todos los lotes estén en A.

import { createClient } from '@supabase/supabase-js';
import { loadEnv, requireEnv } from './env';

loadEnv();
const supabase = createClient(
  requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false } },
);

async function main() {
  const piso = Number(process.argv[2]);
  if (!Number.isFinite(piso) || piso <= 0) {
    console.error('uso: npx tsx scripts/set-precio-contado.ts <monto>   (ej. 29999)');
    process.exit(1);
  }

  // El lote más chico define el piso.
  const { data: lots, error: lotErr } = await supabase
    .from('lots')
    .select('area_m2')
    .is('deleted_at', null)
    .order('area_m2', { ascending: true })
    .limit(1);
  if (lotErr || !lots?.length) {
    console.error('no se pudieron leer los lotes:', lotErr?.message);
    process.exit(1);
  }
  const areaMin = Number(lots[0].area_m2);

  const { data: cats, error: catErr } = await supabase
    .from('pricing_categories')
    .select('id, code, price_per_m2')
    .order('code');
  if (catErr || !cats?.length) {
    console.error('no se pudieron leer las categorías:', catErr?.message);
    process.exit(1);
  }

  const base = cats.find((c) => c.code === 'A');
  if (!base) {
    console.error('no existe la categoría A');
    process.exit(1);
  }

  const nuevoA = piso / areaMin;
  const factor = nuevoA / Number(base.price_per_m2);

  console.log(`lote más chico: ${areaMin} m² → piso Bs ${piso.toLocaleString('es-BO')}`);
  console.log(`categoría A: ${Number(base.price_per_m2)} → ${nuevoA.toFixed(4)} Bs/m² (x${factor.toFixed(4)})`);

  for (const c of cats) {
    const nuevo = Math.round(Number(c.price_per_m2) * factor * 10000) / 10000;
    const { error } = await supabase
      .from('pricing_categories')
      .update({ price_per_m2: nuevo })
      .eq('id', c.id);
    if (error) {
      console.error(`  ${c.code}: ${error.message}`);
      continue;
    }
    console.log(`  ${c.code}: ${Number(c.price_per_m2)} → ${nuevo} Bs/m²  (300 m² = Bs ${Math.round(nuevo * 300).toLocaleString('es-BO')})`);
  }

  // Comprobar contra la realidad, no contra la aritmética de arriba.
  const { data: check } = await supabase.rpc('get_lot_statuses', {
    p_project_id: (await supabase.from('projects').select('id').eq('slug', 'prados-del-sur').single())
      .data?.id,
  });
  const precios = ((check as { lots?: { price: number | null }[] } | null)?.lots ?? [])
    .map((l) => l.price)
    .filter((p): p is number => typeof p === 'number' && p > 0)
    .sort((a, b) => a - b);
  if (precios.length) {
    console.log(
      `\nverificado en la base: ${precios.length} lotes con precio · ` +
        `más barato Bs ${precios[0].toLocaleString('es-BO')} · ` +
        `más caro Bs ${precios[precios.length - 1].toLocaleString('es-BO')}`,
    );
  }
}

void main();
