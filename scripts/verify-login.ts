// Read-only check: does this email + password actually sign in?
//
// Run: NODE_OPTIONS=--experimental-websocket npx tsx scripts/verify-login.ts <correo> <contraseña>
//
// Uses the PUBLIC anon key, exactly like the browser does at /admin/login, so a
// pass here means the real login form will work — not just the admin API.

import { createClient } from '@supabase/supabase-js';
import { loadEnv, requireEnv } from './env';

loadEnv();
const supabase = createClient(
  requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  { auth: { persistSession: false } },
);

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error('uso: npx tsx scripts/verify-login.ts <correo> <contraseña>');
    process.exit(1);
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    console.error('LOGIN FALLA:', error.message);
    process.exit(1);
  }
  console.log('LOGIN OK —', data.user?.email);

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', data.user!.id)
    .maybeSingle();
  console.log('perfil: rol =', profile?.role, '| activo =', profile?.is_active);

  await supabase.auth.signOut();
}

void main();
