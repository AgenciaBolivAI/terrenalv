import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Publishes the project geometry: verifies the admin session, calls the
 * self-authorizing publish_geometry RPC with the USER's cookie client (drafts →
 * published, geometry_version bump, returns the compact snapshot), then uploads
 * the snapshot with the service client to the public `maps` bucket at
 * {slug}/geometry-v{N}.json (content-addressed by version → cache forever).
 */
export async function POST(req: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.json({ error: 'Sin conexión a la base de datos.' }, { status: 503 });
  }

  let projectId: string | null = null;
  try {
    const body = (await req.json()) as { projectId?: unknown };
    if (typeof body.projectId === 'string') projectId = body.projectId;
  } catch {
    // handled below
  }
  if (!projectId || !UUID_RE.test(projectId)) {
    return NextResponse.json({ error: 'Parámetro projectId inválido.' }, { status: 400 });
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
    .select('role, is_active')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile?.is_active || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Solo administradores pueden publicar.' }, { status: 403 });
  }

  const { data: project } = await supabase
    .from('projects')
    .select('slug')
    .eq('id', projectId)
    .maybeSingle();
  if (!project?.slug) {
    return NextResponse.json({ error: 'Proyecto no encontrado.' }, { status: 404 });
  }

  // The RPC self-authorizes (assert_admin) — called as the signed-in user.
  const { data: snapshot, error: rpcError } = await supabase.rpc('publish_geometry', {
    p_project_id: projectId,
  });
  if (rpcError) {
    const msg = rpcError.message ?? '';
    if (msg.includes('LOTS_OVERLAP_GLOBAL')) {
      return NextResponse.json(
        {
          error:
            'Hay lotes superpuestos entre manzanas; corrige la superposición antes de publicar.',
        },
        { status: 409 },
      );
    }
    if (msg.includes('NO_AUTORIZADO')) {
      return NextResponse.json({ error: 'No tienes permiso para publicar.' }, { status: 403 });
    }
    return NextResponse.json({ error: 'No se pudo publicar la geometría.' }, { status: 500 });
  }

  const version = (snapshot as { v?: number } | null)?.v;
  if (!version || !Number.isFinite(version)) {
    return NextResponse.json({ error: 'La publicación no devolvió una versión.' }, { status: 500 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      {
        error:
          'Se publicó en la base de datos, pero falta SUPABASE_SERVICE_ROLE_KEY para subir el snapshot. Configúralo y publica de nuevo.',
      },
      { status: 503 },
    );
  }

  const path = `${project.slug}/geometry-v${version}.json`;
  const { error: uploadError } = await admin.storage
    .from('maps')
    .upload(path, JSON.stringify(snapshot), {
      upsert: true,
      contentType: 'application/json',
      cacheControl: '31536000',
    });
  if (uploadError) {
    return NextResponse.json(
      {
        error: `La base de datos quedó publicada (v${version}) pero el snapshot no se subió: ${uploadError.message}. Publica de nuevo para reintentar.`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ version });
}
