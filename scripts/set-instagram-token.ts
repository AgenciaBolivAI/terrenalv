// Connect the landing page's Instagram feed.
//
// Run: NODE_OPTIONS=--experimental-websocket npx tsx scripts/set-instagram-token.ts <token>
//
// Takes the token Meta hands you in the app dashboard — short-lived or
// long-lived, it works out which — exchanges a short-lived one for a 60-day
// token, verifies it can actually read the account's media, and stores it in
// settings.instagram_token with is_public = false.
//
// After this the site refreshes the token by itself (see
// src/features/landing/instagram.ts), so this only ever needs running once,
// or again if the token is revoked.
//
// The token is a credential: it is never printed in full and never committed.
// Pass it as an argument, not by editing this file.

import { createClient } from '@supabase/supabase-js';
import { loadEnv, requireEnv } from './env';

loadEnv();
const supabase = createClient(
  requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false } },
);

const GRAPH = 'https://graph.instagram.com';
const KEY = 'instagram_token';

/** Never log a credential in full. */
function mask(token: string): string {
  return `${token.slice(0, 6)}…${token.slice(-4)} (${token.length} caracteres)`;
}

/**
 * Try to turn a short-lived token into a 60-day one. Needs the app secret.
 * A token that is already long-lived comes back as an error, which is fine —
 * we fall through and use what we were given.
 */
async function exchange(token: string): Promise<{ token: string; expiresIn: number } | null> {
  const secret = process.env.INSTAGRAM_APP_SECRET;
  if (!secret) return null;
  const url =
    `${GRAPH}/access_token?grant_type=ig_exchange_token` +
    `&client_secret=${encodeURIComponent(secret)}&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.log('  (no se pudo canjear por uno de larga duración:', res.status, '— sigo con el que diste)');
    return null;
  }
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token || !body.expires_in) return null;
  return { token: body.access_token, expiresIn: body.expires_in };
}

async function main() {
  const given = process.argv[2]?.trim();
  if (!given) {
    console.error('uso: npx tsx scripts/set-instagram-token.ts <token>');
    console.error('(opcional: INSTAGRAM_APP_SECRET en .env.local para canjearlo por 60 días)');
    process.exit(1);
  }

  console.log('token recibido:', mask(given));

  const long = await exchange(given);
  const token = long?.token ?? given;
  if (long) console.log('canjeado por uno de larga duración:', mask(token));

  // Prove it works BEFORE storing it — a token that cannot read media would
  // silently leave the page on its fallback with nothing explaining why.
  const check = await fetch(
    `${GRAPH}/me/media?fields=id,permalink,timestamp&limit=3&access_token=${encodeURIComponent(token)}`,
  );
  if (!check.ok) {
    console.error('el token NO puede leer las publicaciones:', check.status, await check.text());
    console.error('no se guardó nada.');
    process.exit(1);
  }
  const media = (await check.json()) as { data?: { permalink: string; timestamp: string }[] };
  const posts = media.data ?? [];
  console.log(`el token lee ${posts.length} publicaciones:`);
  for (const p of posts) console.log(`  ${p.timestamp}  ${p.permalink}`);
  if (!posts.length) {
    console.error('la cuenta no devolvió publicaciones — revisá que sea la cuenta correcta.');
    process.exit(1);
  }

  // Long-lived Instagram tokens last 60 days; assume that when Meta did not say.
  const expiresIn = long?.expiresIn ?? 60 * 24 * 3600;
  const now = new Date();
  const value = {
    token,
    expires_at: new Date(now.getTime() + expiresIn * 1000).toISOString(),
    obtained_at: now.toISOString(),
  };

  const { data: existing } = await supabase
    .from('settings')
    .select('id')
    .eq('key', KEY)
    .is('project_id', null)
    .maybeSingle();

  const { error } = existing
    ? await supabase
        .from('settings')
        .update({ value, is_public: false, updated_at: now.toISOString() })
        .eq('id', existing.id)
    : await supabase
        .from('settings')
        .insert({ project_id: null, key: KEY, value, is_public: false });

  if (error) {
    console.error('no se pudo guardar:', error.message);
    process.exit(1);
  }

  console.log(`guardado en settings.${KEY} (is_public: false)`);
  console.log('vence:', value.expires_at, '— el sitio lo renueva solo antes de esa fecha.');
}

void main();
