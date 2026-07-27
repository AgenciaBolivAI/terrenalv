import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Resolve a setting: project override → global default → fallback.
 * Server-side only (settings rows are mostly is_public = false).
 */
export async function getSetting<T>(
  admin: SupabaseClient,
  projectId: string | null,
  key: string,
  fallback: T,
): Promise<T> {
  const { data } = await admin
    .from('settings')
    .select('project_id, value')
    .eq('key', key)
    .or(projectId ? `project_id.eq.${projectId},project_id.is.null` : 'project_id.is.null');
  if (!data?.length) return fallback;
  const specific = projectId ? data.find((r) => r.project_id === projectId) : undefined;
  const global = data.find((r) => r.project_id === null);
  const value = (specific ?? global)?.value;
  return (value ?? fallback) as T;
}
