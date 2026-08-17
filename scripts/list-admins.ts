// Read-only: which accounts can sign into /admin, and with which email.
// Run: NODE_OPTIONS=--experimental-websocket npx tsx scripts/list-admins.ts

import { createClient } from '@supabase/supabase-js';
import { loadEnv, requireEnv } from './env';

loadEnv();
const supabase = createClient(
  requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false } },
);

async function main() {
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) {
    console.error('no se pudo listar:', error.message);
    process.exit(1);
  }
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, role, is_active');
  const byId = new Map((profiles ?? []).map((p) => [p.id as string, p]));

  console.log(`usuarios de autenticación: ${data.users.length}`);
  for (const u of data.users) {
    const p = byId.get(u.id);
    console.log(
      `  ${(u.email ?? '(sin correo)').padEnd(34)} ` +
        `rol=${String(p?.role ?? '— sin perfil —').padEnd(10)} ` +
        `activo=${p?.is_active ?? '—'}  ` +
        `confirmado=${u.email_confirmed_at ? 'sí' : 'NO'}  ` +
        `último ingreso=${u.last_sign_in_at ?? 'nunca'}`,
    );
  }
  const orphans = (profiles ?? []).filter((p) => !data.users.some((u) => u.id === p.id));
  if (orphans.length) console.log('perfiles sin usuario de auth:', orphans.map((o) => o.full_name));
}

void main();
