import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { Profile } from '@/lib/db-types';
import { PROJECT_SLUG } from './constants';
import { hasSupabaseConfig } from '@/lib/supabase/config';

export interface AdminProject {
  id: string;
  slug: string;
  name: string;
  currency: 'USD' | 'BOB';
}

export type AdminContext =
  | { ok: false; reason: 'env' }
  | { ok: false; reason: 'auth' }
  | { ok: false; reason: 'profile'; email: string | null }
  | {
      ok: true;
      userId: string;
      email: string | null;
      profile: Profile;
      project: AdminProject | null;
    };

/**
 * Resolve the signed-in team member + project for admin pages. Defensive: when
 * env vars are missing or queries fail, returns typed failures instead of
 * crashing the server component (the DB may not exist yet).
 */
export async function getAdminContext(): Promise<AdminContext> {
  if (!hasSupabaseConfig) {
    return { ok: false, reason: 'env' };
  }
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, reason: 'auth' };

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, full_name, role, phone, is_active')
      .eq('id', user.id)
      .maybeSingle();
    if (!profile || !profile.is_active) {
      return { ok: false, reason: 'profile', email: user.email ?? null };
    }

    const { data: project } = await supabase
      .from('projects')
      .select('id, slug, name, currency')
      .eq('slug', PROJECT_SLUG)
      .maybeSingle();

    return {
      ok: true,
      userId: user.id,
      email: user.email ?? null,
      profile: profile as Profile,
      project: (project as AdminProject | null) ?? null,
    };
  } catch {
    return { ok: false, reason: 'env' };
  }
}
