import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasSupabaseConfig } from '@/lib/supabase/config';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Un enlace corto y firmado para ver un papel del file.
 *
 * El bucket `hr-docs` es privado —ahí hay carnets y contratos—, así que el
 * enlace lo firma la clave de servicio recién después de comprobar, con la
 * sesión de quien pide, que es del equipo y que su acceso a RRHH está abierto.
 */
export async function GET(req: NextRequest) {
  const docId = req.nextUrl.searchParams.get('doc');
  if (!docId || !UUID_RE.test(docId)) {
    return NextResponse.json({ error: 'Parámetro doc inválido.' }, { status: 400 });
  }
  if (!hasSupabaseConfig) {
    return NextResponse.json({ error: 'Sin conexión a la base de datos.' }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_active')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile?.is_active) return NextResponse.json({ error: 'Sin permiso.' }, { status: 403 });

  const { data: acceso } = await supabase.rpc('mi_acceso');
  if (((acceso as Record<string, string> | null)?.['rrhh'] ?? 'no') === 'no') {
    return NextResponse.json({ error: 'Sin permiso.' }, { status: 403 });
  }

  // Se lee con la sesión de quien pide: si la RLS no le deja ver la ficha,
  // tampoco hay enlace que firmar.
  const { data: doc } = await supabase
    .from('hr_documentos')
    .select('storage_path, deleted_at')
    .eq('id', docId)
    .maybeSingle();
  if (!doc?.storage_path || doc.deleted_at) {
    return NextResponse.json({ error: 'No se encontró el documento.' }, { status: 404 });
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

  const { data: signed, error } = await admin.storage
    .from('hr-docs')
    .createSignedUrl(doc.storage_path, 600);
  if (error || !signed?.signedUrl) {
    return NextResponse.json({ error: 'No se pudo generar el enlace.' }, { status: 500 });
  }

  return NextResponse.json({ url: signed.signedUrl });
}
