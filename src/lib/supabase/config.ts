// Public Supabase configuration.
//
// These two values are public by design: the anon key is compiled into the
// browser bundle of every Supabase app, and Row Level Security is what actually
// protects the data (anon reads published geometry and lot status only — never
// buyer PII, verified against the live database).
//
// They are literals rather than env-only for two reasons learned the hard way in
// production:
//   1. Vercel does NOT read committed .env files — it injects dashboard
//      variables exclusively — so an env-only app renders "Mapa en preparación"
//      until someone pastes values into a dashboard.
//   2. A malformed or wrong-project key pasted into that dashboard silently
//      takes precedence and breaks the whole map ("Invalid API key").
//
// So: an environment variable still wins, but only if it is actually usable.
// Anything malformed is rejected loudly and the built-in pair is used instead.
//
// SECRETS ARE NOT HERE and must never be: SUPABASE_SERVICE_ROLE_KEY,
// RESEND_API_KEY and TURNSTILE_SECRET_KEY are read from the environment only.

const BUILTIN_URL = 'https://otkqzrcuuafjdaxjeyvx.supabase.co';

/** Known-good anon key for BUILTIN_URL. Exported so callers can retry with it. */
export const BUILTIN_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90a3F6cmN1dWFmamRheGpleXZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxMzE1MDYsImV4cCI6MjEwMDcwNzUwNn0.RMhZxCItAXQuZvDlhA_Mi4bAEnTknnyEzj09OqH03js';

/** Supabase accepts a JWT (legacy anon) or the newer sb_publishable_ format. */
function isUsableKey(v: string): boolean {
  return /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(v) || /^sb_publishable_[\w-]+$/.test(v);
}

function resolveUrl(): string {
  const env = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!env) return BUILTIN_URL;
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(env)) {
    console.error(
      `[supabase] NEXT_PUBLIC_SUPABASE_URL no parece una URL de Supabase (${env}); usando la incorporada`,
    );
    return BUILTIN_URL;
  }
  return env.replace(/\/+$/, '');
}

function resolveKey(): string {
  const env = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!env) return BUILTIN_ANON_KEY;
  if (!isUsableKey(env)) {
    console.error(
      '[supabase] NEXT_PUBLIC_SUPABASE_ANON_KEY con formato inválido ' +
        `(largo ${env.length}); usando la clave incorporada`,
    );
    return BUILTIN_ANON_KEY;
  }
  return env;
}

export const SUPABASE_URL = resolveUrl();
export const SUPABASE_ANON_KEY = resolveKey();

/** True when the resolved key is NOT the built-in one — i.e. an env override is
 *  in play and could be wrong for this project. Callers retry with the built-in
 *  pair when Supabase answers "Invalid API key". */
export const USING_ENV_KEY = SUPABASE_ANON_KEY !== BUILTIN_ANON_KEY;

/** Retry is only meaningful when the override points at the same project. */
export const CAN_RETRY_BUILTIN = USING_ENV_KEY && SUPABASE_URL === BUILTIN_URL;

export const hasSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
