// Set a new password on an existing admin account.
//
// Run: NODE_OPTIONS=--experimental-websocket npx tsx scripts/reset-password.ts <correo> [contraseña]
//
// With no password given it generates a strong one and prints it ONCE. Nothing
// is written to a file and nothing is committed — copy it, sign in, and change
// it from Supabase → Authentication → Users if you want one you'll remember.
//
// Refuses to touch an address that has no account, so a typo can't silently
// "succeed" against nothing.

import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadEnv, requireEnv } from './env';

loadEnv();
const supabase = createClient(
  requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false } },
);

/** Unambiguous alphabet: no O/0, l/1/I — these get read off a screen. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function generate(length = 20): string {
  // rejection-free: 56 symbols, take bytes mod 56 with a bias small enough to
  // not matter at 20 chars, but do it properly anyway with a rejection loop.
  const out: string[] = [];
  while (out.length < length) {
    for (const b of randomBytes(length)) {
      if (b >= 256 - (256 % ALPHABET.length)) continue; // reject biased tail
      out.push(ALPHABET[b % ALPHABET.length]);
      if (out.length === length) break;
    }
  }
  return out.join('');
}

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error('uso: npx tsx scripts/reset-password.ts <correo> [contraseña]');
    process.exit(1);
  }
  const given = process.argv[3];

  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) {
    console.error('no se pudo listar usuarios:', error.message);
    process.exit(1);
  }
  const user = data.users.find((u) => u.email?.toLowerCase() === email);
  if (!user) {
    console.error(`no existe ninguna cuenta con el correo ${email}.`);
    console.error('cuentas existentes:', data.users.map((u) => u.email).join(', '));
    process.exit(1);
  }

  const password = given ?? generate();
  const { error: upErr } = await supabase.auth.admin.updateUserById(user.id, {
    password,
    email_confirm: true,
  });
  if (upErr) {
    console.error('no se pudo cambiar la contraseña:', upErr.message);
    process.exit(1);
  }

  console.log(`contraseña actualizada para ${email}`);
  if (!given) {
    console.log('');
    console.log('  ' + password);
    console.log('');
    console.log('(se muestra una sola vez — copiala ahora)');
  }
  console.log('ingresá en /admin/login');
}

void main();
