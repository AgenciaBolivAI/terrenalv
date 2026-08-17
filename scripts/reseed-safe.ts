// Replace the map geometry without destroying live reservations.
//
// Run: NODE_OPTIONS=--experimental-websocket npx tsx scripts/reseed-safe.ts
//
// Hard-deleting lots is blocked by tg_guard_lot_delete once a reservation
// points at one, and deleting the reservation would take a real customer's lot
// away. Instead: soft-delete the old lots (the (manzana, number) unique index is
// partial on deleted_at IS NULL, so the numbers are freed while the foreign key
// stays valid), let seed-geometry insert the new ones, then re-point each live
// reservation at the SAME manzana/lote in the new plano.
//
// Prints the reservations it will move BEFORE touching anything.

import { createClient } from '@supabase/supabase-js';
import { loadEnv, requireEnv } from './env';

loadEnv();
const supabase = createClient(
  requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false } },
);

const LIVE = ['pendiente_pago', 'en_verificacion', 'rechazo_reintento', 'confirmada'];

interface Live {
  id: string;
  tracking_code: string;
  status: string;
  manzana: string;
  numero: string;
}

async function liveReservations(): Promise<Live[]> {
  const { data, error } = await supabase
    .from('reservations')
    .select('id, tracking_code, status, lots!reservations_lot_id_fkey(number, manzanas(code))')
    .in('status', LIVE);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => {
    const lot = r.lots as unknown as { number: string; manzanas: { code: string } | null } | null;
    return {
      id: r.id as string,
      tracking_code: r.tracking_code as string,
      status: r.status as string,
      manzana: lot?.manzanas?.code ?? '?',
      numero: lot?.number ?? '?',
    };
  });
}

async function main() {
  const mode = process.argv[2];
  const live = await liveReservations();
  console.log(`reservas vivas: ${live.length}`);
  for (const r of live) console.log(`  ${r.tracking_code}  ${r.status}  ${r.manzana}/${r.numero}`);

  if (mode === 'pre') {
    const { error, count } = await supabase
      .from('lots')
      .update({ deleted_at: new Date().toISOString(), active_reservation_id: null }, { count: 'exact' })
      .is('deleted_at', null);
    if (error) {
      console.error('soft-delete falló:', error.message);
      process.exit(1);
    }
    console.log(`lotes marcados como históricos: ${count}`);
    console.log('ahora: npx tsx scripts/seed-geometry.ts   luego: reseed-safe.ts post');
    return;
  }

  if (mode === 'post') {
    for (const r of live) {
      const { data: lot } = await supabase
        .from('lots')
        .select('id, manzanas!inner(code)')
        .eq('number', r.numero)
        .eq('manzanas.code', r.manzana)
        .is('deleted_at', null)
        .maybeSingle();
      if (!lot) {
        console.error(`  ${r.tracking_code}: ${r.manzana}/${r.numero} no existe en el plano nuevo — SIN TOCAR`);
        continue;
      }
      const { error: e1 } = await supabase
        .from('reservations')
        .update({ lot_id: lot.id })
        .eq('id', r.id);
      if (e1) {
        console.error(`  ${r.tracking_code}: ${e1.message}`);
        continue;
      }
      const { error: e2 } = await supabase
        .from('lots')
        .update({ status: 'reservado', active_reservation_id: r.id })
        .eq('id', lot.id);
      if (e2) console.error(`  ${r.tracking_code} (bloqueo del lote): ${e2.message}`);
      else console.log(`  ${r.tracking_code} → ${r.manzana}/${r.numero} (lote nuevo, bloqueado)`);
    }
    return;
  }

  console.log('\nuso: reseed-safe.ts pre | post');
}

void main();
