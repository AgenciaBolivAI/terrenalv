import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasSupabaseConfig } from '@/lib/supabase/config';
import { hashClientIp } from '@/lib/server/client-ip';

export const runtime = 'nodejs';

const schema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Revisá el correo.'),
  password: z.string().min(8, 'La contraseña necesita al menos 8 caracteres.'),
  full_name: z.string().trim().min(3, 'Escribí tu nombre completo.'),
  phone: z.string().trim().max(30).optional().nullable(),
  ci: z.string().trim().max(30).optional().nullable(),
  birth_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  city: z.string().trim().max(80).optional().nullable(),
  como_nos_conocio: z.string().trim().max(80).optional().nullable(),
  marketing_opt_in: z.boolean().optional(),
});

/**
 * Alta de comprador SIN vuelta por el correo.
 *
 * Supabase tiene la confirmación por correo encendida (`mailer_autoconfirm`
 * en false), y esa palanca se cambia con un token de administración que no
 * vive en el repo. No hace falta: la cuenta se crea desde el servidor con el
 * correo ya confirmado —el mismo camino que usan las cuentas del equipo— así
 * que GoTrue no manda ningún correo y la persona entra en el acto.
 *
 * La contraseña viaja al servidor y va derecho a la API de Supabase: no se
 * guarda en ninguna tabla nuestra, no entra en la auditoría y no se escribe
 * en ningún log.
 *
 * Esta puerta es PÚBLICA, así que trae su propio freno: cinco cuentas por hora
 * desde la misma conexión, y el freno de verdad vive en la base (alta_de_cliente),
 * donde no se puede saltear llamando a otra cosa. Y no crea NUNCA un perfil de
 * equipo: un cliente jamás es personal.
 */
export async function POST(req: NextRequest) {
  if (!hasSupabaseConfig) {
    return NextResponse.json({ error: 'Sin conexión a la base de datos.' }, { status: 503 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Revisá los datos.' },
      { status: 400 },
    );
  }
  const d = parsed.data;

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: 'Sin conexión a la base de datos.' }, { status: 503 });
  }

  const { data: creado, error: errAuth } = await admin.auth.admin.createUser({
    email: d.email,
    password: d.password,
    email_confirm: true, // sin vuelta por el correo
    user_metadata: { full_name: d.full_name },
  });

  if (errAuth || !creado?.user) {
    const yaExiste = /already|registered|exists/i.test(errAuth?.message ?? '');
    return NextResponse.json(
      {
        error: yaExiste
          ? 'Ya hay una cuenta con ese correo. Entrá con tu contraseña.'
          : 'No pudimos crear la cuenta. Revisá el correo e intentá de nuevo.',
        code: yaExiste ? 'YA_EXISTE' : 'ERROR',
      },
      { status: yaExiste ? 409 : 400 },
    );
  }

  const { error: errFicha } = await admin.rpc('alta_de_cliente', {
    p_uid: creado.user.id,
    p_full_name: d.full_name,
    p_email: d.email,
    p_phone: d.phone ?? null,
    p_ci: d.ci ?? null,
    p_birth_date: d.birth_date ?? null,
    p_city: d.city ?? null,
    p_como_nos_conocio: d.como_nos_conocio ?? null,
    p_marketing_opt_in: d.marketing_opt_in ?? true,
    p_ip_hash: hashClientIp(req.headers),
  });

  if (errFicha) {
    // La cuenta de Auth quedó creada pero sin ficha: se deshace, porque una
    // cuenta a medias no la puede arreglar ni el cliente ni la oficina.
    await admin.auth.admin.deleteUser(creado.user.id).catch(() => undefined);
    const demasiadas = /DEMASIADAS_CUENTAS/.test(errFicha.message);
    return NextResponse.json(
      {
        error: demasiadas
          ? 'Se crearon varias cuentas desde esta conexión. Probá más tarde.'
          : 'No pudimos guardar tus datos. Intentá de nuevo.',
      },
      { status: demasiadas ? 429 : 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
