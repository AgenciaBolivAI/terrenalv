-- Fixes from the Supabase security linter.
-- NOT changed (intentional design, self-authorizing SECURITY DEFINER RPCs):
--   * get_map_manifest / get_lot_statuses stay anon-executable — public read RPCs, zero PII.
--   * Team RPCs stay authenticated-executable — they enforce assert_team()/assert_admin() internally.

-- 1. Pin search_path on the remaining private helpers.
alter function private.tg_set_updated_at() set search_path = public;
alter function private.is_service() set search_path = public;
alter function private.normalize_ci(text) set search_path = public;
alter function private.normalize_phone_bo(text) set search_path = public;
alter function private.gen_tracking_code(text) set search_path = private;

-- 2. pg_net out of the public schema (its net.* functions live in schema `net` either way).
drop extension if exists pg_net;
create extension pg_net with schema extensions;

-- 3. Public bucket objects are reachable via their public URL without a policy;
--    the broad SELECT policy only added enumeration. Remove it.
drop policy if exists maps_public_read on storage.objects;
