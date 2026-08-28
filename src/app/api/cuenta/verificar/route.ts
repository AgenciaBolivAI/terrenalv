import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasSupabaseConfig } from '@/lib/supabase/config';

export const runtime = 'nodejs';

/**
 * Pedir y confirmar el correo del comprador.
 *
 * POST — encola el correo con el enlace. El token viaja UNA vez por acá y en
 * la tabla queda solo su hash: si alguien lee la base, no puede confirmar
 * casillas ajenas con lo que ve.
 *
 * GET ?token=… — es el enlace del correo. No mira la sesión a propósito:
 * quien abre la casilla es justamente quien tenía que probar que es suya, y
 * puede abrirla desde el teléfono donde no está logueado.
 */
export async function POST(req: NextRequest) {
  if (!hasSupabaseConfig) {
    return NextResponse.json({ error: 'Sin conexión.' }, { status: 503 });
  }
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });

  const { data, error } = await supabase.rpc('pedir_verificacion_de_correo');
  if (error) return NextResponse.json({ error: 'No pudimos enviarlo.' }, { status: 400 });

  const r = data as {
    ok: boolean;
    ya_verificado?: boolean;
    error?: string;
    token?: string;
    email?: string;
    nombre?: string;
  };
  if (r.ya_verificado) return NextResponse.json({ ok: true, ya_verificado: true });
  if (!r.ok || !r.token) {
    return NextResponse.json(
      {
        error:
          r.error === 'ESPERA_UN_RATO'
            ? 'Ya te mandamos uno hace un momento. Revisá tu correo, incluido el spam.'
            : 'No pudimos enviarlo.',
      },
      { status: 429 },
    );
  }

  const base = req.nextUrl.origin;
  const enlace = `${base}/api/cuenta/verificar?token=${encodeURIComponent(r.token)}`;

  // Entra por el mismo buzón que todo lo demás: si el envío falla, queda en
  // cola y se reintenta, en vez de perderse.
  const admin = createAdminClient();
  const { error: errCola } = await admin.rpc('encolar_verificacion_correo', {
    p_customer_id: user.id,
    p_email: r.email ?? '',
    p_nombre: r.nombre ?? '',
    p_enlace: enlace,
  });
  if (errCola) return NextResponse.json({ error: 'No pudimos enviarlo.' }, { status: 400 });

  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? '';
  const destino = new URL('/cuenta/panel', req.nextUrl.origin);

  if (!hasSupabaseConfig || !token) {
    destino.searchParams.set('correo', 'error');
    return NextResponse.redirect(destino);
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('confirmar_correo_con_token', { p_token: token });
  const r = data as { ok?: boolean } | null;
  destino.searchParams.set('correo', !error && r?.ok ? 'listo' : 'error');
  return NextResponse.redirect(destino);
}
