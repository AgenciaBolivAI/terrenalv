import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasSupabaseConfig } from '@/lib/supabase/config';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Mints a short-TTL signed URL for a payment proof. The payment-proofs bucket is
 * private; team membership is verified against the caller's session before the
 * service client signs anything.
 */
export async function GET(req: NextRequest) {
  const paymentId = req.nextUrl.searchParams.get('payment');
  if (!paymentId || !UUID_RE.test(paymentId)) {
    return NextResponse.json({ error: 'Parámetro payment inválido.' }, { status: 400 });
  }
  if (!hasSupabaseConfig) {
    return NextResponse.json({ error: 'Sin conexión a la base de datos.' }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_active')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile?.is_active) {
    return NextResponse.json({ error: 'Sin permiso.' }, { status: 403 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY en el servidor.' },
      { status: 503 },
    );
  }

  const { data: payment } = await admin
    .from('payments')
    .select('proof_storage_path')
    .eq('id', paymentId)
    .maybeSingle();
  if (!payment?.proof_storage_path) {
    return NextResponse.json({ error: 'Este pago no tiene comprobante.' }, { status: 404 });
  }

  const { data: signed, error } = await admin.storage
    .from('payment-proofs')
    .createSignedUrl(payment.proof_storage_path, 600);
  if (error || !signed?.signedUrl) {
    return NextResponse.json({ error: 'No se pudo generar el enlace.' }, { status: 500 });
  }

  return NextResponse.json({ url: signed.signedUrl, path: payment.proof_storage_path });
}
