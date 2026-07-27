// Creates the initial admin user (the auth trigger creates the matching profile).
// Run: npx tsx scripts/seed-team.ts admin@terrenalv.com "ContraseñaSegura123" "Nombre Apellido"

import { createClient } from '@supabase/supabase-js';
import { loadEnv, requireEnv } from './env';

loadEnv();
const supabase = createClient(
  requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false } },
);

async function main() {
  const [email, password, fullName] = process.argv.slice(2);
  if (!email || !password) {
    console.error('Uso: npx tsx scripts/seed-team.ts <email> <password> [nombre completo]');
    process.exit(1);
  }
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName ?? email.split('@')[0], role: 'admin' },
  });
  if (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
  console.log(`Admin creado: ${data.user?.email} (${data.user?.id})`);
}

main();
