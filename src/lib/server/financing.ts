import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { parseFinancingPlan, type FinancingPlan } from '@/lib/financing';
import { getSetting } from './settings';

/**
 * Read the payment plan shown to buyers. `financing_plan` is is_public = true,
 * so the anon client is enough — no service role, which means the plan still
 * renders on deployments where only the public keys are configured.
 *
 * Any failure degrades to null: a missing plan hides the rows, it never blocks
 * the page.
 */
export async function loadFinancingPlan(
  client: SupabaseClient,
  projectId: string | null,
): Promise<FinancingPlan | null> {
  try {
    const raw = await getSetting<unknown>(client, projectId, 'financing_plan', null);
    return parseFinancingPlan(raw);
  } catch {
    return null;
  }
}
