// Public Supabase configuration.
//
// These two values are public by design: the anon key is compiled into the
// browser bundle of every Supabase app, and Row Level Security is what actually
// protects the data (anon can read published geometry and lot status only —
// never buyer PII, verified against the live database).
//
// They are literals rather than env-only because Vercel does NOT read committed
// .env files: it injects dashboard variables exclusively. Depending on env vars
// for these meant a fresh deploy rendered "Mapa en preparación" until someone
// pasted them into a dashboard. The app must work when you deploy it.
//
// Environment variables still win when present, so any environment (a preview
// branch, a second project, a rotated key) can override without a code change.
//
// SECRETS ARE NOT HERE and must never be: SUPABASE_SERVICE_ROLE_KEY,
// RESEND_API_KEY and TURNSTILE_SECRET_KEY are read from the environment only.

export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://otkqzrcuuafjdaxjeyvx.supabase.co';

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90a3F6cmN1dWFmamRheGpleXZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxMzE1MDYsImV4cCI6MjEwMDcwNzUwNn0.RMhZxCItAXQuZvDlhA_Mi4bAEnTknnyEzj09OqH03js';

/** True when both public values resolve — always true now, kept for call sites. */
export const hasSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
