import 'server-only';

import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import type { Profile } from '@/lib/db-types';
import { PROJECT_SLUG, PROJECT_COOKIE } from './constants';
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
      projects: AdminProject[];
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

    // Qué urbanización está mirando esta persona.
    //
    // Antes era una constante, así que el panel solo podía administrar Prados
    // del Sur aunque la base fuera multi-proyecto desde el día uno. Ahora manda
    // la cookie que deja el selector; si no hay (o apunta a un proyecto que ya
    // no existe), cae al slug original y después a cualquiera que haya, para
    // que el panel nunca quede sin proyecto por una cookie vieja.
    const elegido = (await cookies()).get(PROJECT_COOKIE)?.value ?? null;

    const { data: proyectos } = await supabase
      .from('projects')
      .select('id, slug, name, currency')
      .neq('status', 'archivado')
      .order('created_at');

    const lista = (proyectos ?? []) as AdminProject[];
    const project =
      lista.find((p) => p.slug === elegido) ??
      lista.find((p) => p.slug === PROJECT_SLUG) ??
      lista[0] ??
      null;

    return {
      ok: true,
      userId: user.id,
      email: user.email ?? null,
      profile: profile as Profile,
      project,
      /** Todas las que puede administrar, para el selector de la barra. */
      projects: lista,
    };
  } catch {
    return { ok: false, reason: 'env' };
  }
}
