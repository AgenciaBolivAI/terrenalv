import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasSupabaseConfig } from '@/lib/supabase/config';

export const runtime = 'nodejs';

const schema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Correo inválido'),
  full_name: z.string().trim().min(3, 'Nombre requerido'),
  role: z.enum(['admin', 'ventas', 'contabilidad']),
  // Ocho caracteres es el mínimo que acepta Supabase. Se pide algo más que
  // eso porque esta cuenta entra a la plata de la empresa.
  password: z.string().min(8, 'La contraseña necesita al menos 8 caracteres'),
});

/**
 * Crear una cuenta del equipo con contraseña, sin pasar por el correo.
 *
 * La invitación por correo depende de que el correo llegue — y a veces no
 * llega, o la persona no controla esa casilla todavía. Esto crea la cuenta
 * lista para usar: el correo queda confirmado de entrada y la persona entra
 * con la contraseña que le dio el administrador.
 *
 * Solo un administrador activo puede hacerlo, igual que invitar. La
 * contraseña viaja al servidor y va derecho a la API de Supabase: no se
 * guarda en ninguna tabla nuestra, no se escribe en la auditoría y no se
 * registra en ningún log.
 */
export async function POST(req: NextRequest) {
  if (!hasSupabaseConfig) {
    return NextResponse.json({ error: 'Sin conexión a la base de datos.' }, { status: 503 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
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
    return NextResponse.json(
      { error: 'Solo administradores pueden crear cuentas.' },
      { status: 403 },
    );
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

  const { email, full_name, role, password } = parsed.data;

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, role },
  });

  if (error || !created?.user) {
    const msg = error?.message ?? '';
    if (msg.includes('already been registered') || msg.includes('already registered')) {
      return NextResponse.json({ error: 'Ese correo ya tiene una cuenta.' }, { status: 409 });
    }
    if (msg.toLowerCase().includes('password')) {
      return NextResponse.json(
        { error: 'Esa contraseña no la acepta el sistema. Probá con una más larga.' },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'No se pudo crear la cuenta.' }, { status: 500 });
  }

  // El disparador on_auth_user_created arma el perfil desde la metadata. Se
  // confirma acá igual: si el rol no quedó como se pidió, se corrige — que la
  // cuenta nazca con más permisos de los que el administrador eligió sería
  // peor que fallar.
  const { error: profErr } = await admin
    .from('profiles')
    .upsert(
      { id: created.user.id, full_name, role, is_active: true },
      { onConflict: 'id' },
    );

  if (profErr) {
    return NextResponse.json(
      { error: 'La cuenta se creó pero el perfil quedó a medias. Revisá el equipo.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, id: created.user.id });
}
