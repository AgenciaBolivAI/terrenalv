// Live-database verification suite: the atomic-reservation concurrency guarantee,
// RLS lockdown of PII, guest-RPC privilege, and the expiry path.
// Run AFTER migrations + seed: npx tsx scripts/verify-db.ts
// Uses a throwaway lot reservation and cleans up after itself.

import { createClient } from '@supabase/supabase-js';
import { loadEnv, requireEnv } from './env';

loadEnv();
const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
const service = createClient(url, requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});
const anon = createClient(url, requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
  auth: { persistSession: false },
});

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`  ✔ ${name}`);
  } else {
    fail++;
    console.error(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const TEST_CI = '9999888';
const TEST_PHONE = '+59176000001';

async function findTestLot(): Promise<{ id: string; number: string } | null> {
  // Any published, available, PRICED lot. Seed lots are unpriced, so price one
  // temporarily via price_override and restore afterwards.
  const { data } = await service
    .from('lots')
    .select('id, number, price_override')
    .eq('status', 'disponible')
    .eq('state', 'published')
    .is('deleted_at', null)
    .limit(1);
  if (!data?.length) return null;
  await service.from('lots').update({ price_override: 5000 }).eq('id', data[0].id);
  return data[0];
}

async function main() {
  console.log('— Concurrencia: 20 create_reservation simultáneos sobre un lote —');
  const lot = await findTestLot();
  if (!lot) {
    console.error('No hay lotes publicados para probar. Ejecuta seed-geometry primero.');
    process.exit(1);
  }

  const attempts = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      service
        .rpc('create_reservation', {
          p_lot_id: lot.id,
          p_full_name: `Prueba Concurrencia ${i}`,
          p_ci: `${9000000 + i}`,
          p_phone: `+5917${String(6100000 + i)}`,
          p_email: null,
          p_terms_version: 'test',
          p_ip_hash: `test-ip-${i}`,
          p_user_agent: 'verify-db',
        })
        .then((r) => ({ ok: !r.error, error: r.error?.message, data: r.data })),
    ),
  );
  const winners = attempts.filter((a) => a.ok);
  const losers = attempts.filter((a) => !a.ok);
  check('exactamente 1 gana', winners.length === 1, `ganadores=${winners.length}`);
  check(
    'los 19 restantes reciben LOT_NOT_AVAILABLE',
    losers.length === 19 && losers.every((l) => l.error?.includes('LOT_NOT_AVAILABLE')),
    losers.find((l) => !l.error?.includes('LOT_NOT_AVAILABLE'))?.error,
  );

  const winner = winners[0]?.data as { tracking_code: string; reservation_id: string } | undefined;

  console.log('— Invariante del índice único parcial —');
  if (winner) {
    const { error: directErr } = await service.from('reservations').insert({
      project_id: (await service.from('lots').select('project_id').eq('id', lot.id).single()).data!
        .project_id,
      lot_id: lot.id,
      tracking_code: 'TEST-DUP-0001',
      buyer_full_name: 'Duplicado Test',
      buyer_ci: TEST_CI,
      buyer_ci_normalized: TEST_CI,
      buyer_phone: TEST_PHONE,
      status: 'pendiente_pago',
      price_agreed: 1,
      amount_due: 1,
      amount_due_currency: 'BOB',
      currency: 'USD',
    });
    check(
      'insert directo de segunda reserva activa es rechazado por el índice',
      !!directErr && (directErr.message.includes('reservations_one_active_per_lot') || directErr.message.includes('duplicate key')),
      directErr?.message ?? 'insert SUCCEEDED — invariante rota',
    );
  }

  console.log('— RLS: el rol anon no ve PII ni puede escribir —');
  {
    const { data } = await anon.from('reservations').select('*').limit(5);
    check('anon.select(reservations) devuelve 0 filas', (data ?? []).length === 0);
  }
  {
    const { data } = await anon.from('payments').select('*').limit(5);
    check('anon.select(payments) devuelve 0 filas', (data ?? []).length === 0);
  }
  {
    const { data } = await anon.from('lots').select('id').limit(5);
    check('anon.select(lots) SÍ devuelve filas publicadas', (data ?? []).length > 0);
  }
  {
    const { error } = await anon.rpc('create_reservation', {
      p_lot_id: lot.id,
      p_full_name: 'Anon Directo',
      p_ci: '1234567',
      p_phone: '+59176999999',
    });
    check('anon NO puede llamar create_reservation directamente', !!error);
  }
  {
    const { error } = await anon.from('lots').update({ status: 'vendido' }).eq('id', lot.id);
    const { data: after } = await service.from('lots').select('status').eq('id', lot.id).single();
    check(
      'anon no puede modificar lots.status',
      after?.status === 'reservado',
      error?.message ?? `status=${after?.status}`,
    );
  }

  console.log('— Ciclo de vida: cancelar libera el lote al instante —');
  if (winner) {
    const ciOfWinner = attempts.findIndex((a) => a.ok);
    const { error: cancelErr } = await service.rpc('cancel_reservation', {
      p_tracking_code: winner.tracking_code,
      p_ci: `${9000000 + ciOfWinner}`,
      p_ip_hash: 'verify-db',
    });
    check('cancel_reservation ok', !cancelErr, cancelErr?.message);
    const { data: lotAfter } = await service.from('lots').select('status, active_reservation_id').eq('id', lot.id).single();
    check(
      'lote vuelve a disponible con puntero limpio',
      lotAfter?.status === 'disponible' && lotAfter?.active_reservation_id === null,
      JSON.stringify(lotAfter),
    );
  }

  console.log('— Auditoría y notificaciones registradas —');
  {
    const { data } = await service
      .from('audit_log')
      .select('action')
      .in('action', ['reservation.created', 'reservation.cancelled'])
      .limit(2);
    check('audit_log tiene los eventos', (data ?? []).length >= 2);
    const { data: notif } = await service
      .from('notifications')
      .select('type')
      .eq('type', 'nueva_reserva')
      .limit(1);
    check('notificación nueva_reserva insertada', (notif ?? []).length >= 1);
  }

  // Cleanup: remove test reservations/payments + restore lot pricing.
  console.log('— Limpieza —');
  const { data: testRes } = await service
    .from('reservations')
    .select('id')
    .like('buyer_full_name', 'Prueba Concurrencia%');
  if (testRes?.length) {
    const ids = testRes.map((r) => r.id);
    await service.from('payments').delete().in('reservation_id', ids);
    await service.from('reservations').delete().in('id', ids);
  }
  await service.from('lots').update({ price_override: null, status: 'disponible', active_reservation_id: null }).eq('id', lot.id);
  console.log('  limpieza completa');

  console.log(`\n${pass} pasaron, ${fail} fallaron`);
  process.exit(fail ? 1 : 0);
}

main();
