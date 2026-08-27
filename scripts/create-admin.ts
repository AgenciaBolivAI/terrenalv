// Create a team account and give it a role.
//
// Run: NODE_OPTIONS=--experimental-websocket npx tsx scripts/create-admin.ts //        <correo> <contraseña> "<nombre completo>" [rol]
// (el flag hace falta en Node 20: supabase-js necesita WebSocket nativo)
//      rol: admin (por defecto) | contabilidad | ventas
//
// The normal way to add someone is inviting them from /admin/equipo — that
// flow audits who invited whom. This exists for the accounts that come before
// there is anyone to do the inviting, and for when the owner asks directly.
//
// Creates the auth user with the email already confirmed (nobody has to click a
// link in an inbox they may not control yet), then the matching profiles row.
// If the account already exists it updates the password and role instead of
// failing, so re-running is safe.

import { createClient } from '@supabase/supabase-js';
import { loadEnv, requireEnv } from './env';

loadEnv();
const admin = createClient(
  requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false } },
);

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const password = process.argv[3];
  const fullName = process.argv[4]?.trim();
  // El rol es opcional y por defecto admin, para no cambiarle el
  // comportamiento a quien ya usaba este script con tres argumentos.
  const role = (process.argv[5]?.trim() || 'admin') as 'admin' | 'contabilidad' | 'ventas';
  if (!email || !password || !fullName) {
    console.error(
      'uso: npx tsx scripts/create-admin.ts <correo> <contraseña> "<nombre completo>" [rol]',
    );
    process.exit(1);
  }
  if (!['admin', 'contabilidad', 'ventas'].includes(role)) {
    console.error(`rol desconocido: ${role} — usá admin, contabilidad o ventas`);
    process.exit(1);
  }

  const { data: list, error: listErr } = await admin.auth.admin.listUsers();
  if (listErr) {
    console.error('no se pudo listar usuarios:', listErr.message);
    process.exit(1);
  }
  const existing = list.users.find((u) => u.email?.toLowerCase() === email);

  let userId: string;
  if (existing) {
    console.log(`la cuenta ya existía — actualizo contraseña y rol (${role})`);
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
    });
    if (error) {
      console.error('no se pudo actualizar:', error.message);
      process.exit(1);
    }
    userId = existing.id;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) {
      console.error('no se pudo crear el usuario:', error?.message);
      process.exit(1);
    }
    userId = data.user.id;
    console.log('usuario de autenticación creado');
  }

  const { error: profErr } = await admin
    .from('profiles')
    .upsert({ id: userId, full_name: fullName, role, is_active: true }, { onConflict: 'id' });
  if (profErr) {
    console.error('no se pudo crear el perfil:', profErr.message);
    process.exit(1);
  }
  console.log(`perfil listo — rol ${role}, activo`);
  console.log('id:', userId);
}

void main();
