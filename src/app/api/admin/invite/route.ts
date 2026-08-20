import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasSupabaseConfig } from '@/lib/supabase/config';

export const runtime = 'nodejs';

const inviteSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Correo inválido'),
  full_name: z.string().trim().min(3, 'Nombre requerido'),
  role: z.enum(['admin', 'ventas', 'contabilidad']),
});

/**
 * Invite-only signup: verifies the caller is an active admin (RLS session),
 * then uses the service client's admin API. The DB trigger on auth.users
 * creates the profile from the metadata.
 */
export async function POST(req: NextRequest) {
  if (!hasSupabaseConfig) {
    return NextResponse.json({ error: 'Sin conexión a la base de datos.' }, { status: 503 });
  }

  const parsed = inviteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' },
      { status: 400 },
    );
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
  if (!profile || !profile.is_active || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Solo administradores pueden invitar.' }, { status: 403 });
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

  const { email, full_name, role } = parsed.data;
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name, role },
    redirectTo: `${req.nextUrl.origin}/admin/login`,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('already been registered') || msg.includes('already registered')) {
      return NextResponse.json({ error: 'Ese correo ya tiene una cuenta.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'No se pudo enviar la invitación.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
