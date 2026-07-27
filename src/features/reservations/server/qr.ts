import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PaymentInstructionsSetting } from '@/lib/db-types';

/**
 * Mint a short-lived (2 h) signed URL for the business bank-QR image stored in the
 * private 'bank-assets' bucket. Best effort: any failure returns null and the UI
 * falls back to the textual bank data.
 */
export async function mintQrSignedUrl(
  admin: SupabaseClient,
  instructions: PaymentInstructionsSetting | null | undefined,
): Promise<string | null> {
  const path = instructions?.qr_image_path;
  if (!path) return null;
  try {
    const { data, error } = await admin.storage.from('bank-assets').createSignedUrl(path, 7200);
    if (error) return null;
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}
