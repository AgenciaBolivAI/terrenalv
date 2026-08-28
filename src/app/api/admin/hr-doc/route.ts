// POST /api/admin/hr-doc — sube un papel al file de un dependiente.
//
// Va por el servidor por lo mismo que el comprobante del comprador: las
// imágenes se reprocesan con sharp antes de tocar el storage, lo que borra los
// metadatos EXIF —incluida la ubicación GPS del teléfono que sacó la foto—, y
// el navegador nunca recibe una credencial de subida.
//
// Un file de personal es más delicado que un comprobante de pago: acá hay
// carnets y contratos. El bucket es privado y solo se lee con URL firmada.

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasSupabaseConfig } from '@/lib/supabase/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_RAW_BYTES = 4 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Sniffed = 'jpeg' | 'png' | 'webp' | 'pdf';

/** El tipo declarado por el navegador no se cree: se miran los bytes. */
function sniffKind(buf: Buffer): Sniffed | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return 'png';
  if (
    buf.length >= 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  )
    return 'webp';
  if (buf.length >= 4 && buf.toString('latin1', 0, 4) === '%PDF') return 'pdf';
  return null;
}

type SharpFactory = (typeof import('sharp'))['default'];
let sharpPromise: Promise<SharpFactory | null> | undefined;

function loadSharp(): Promise<SharpFactory | null> {
  if (!sharpPromise) {
    sharpPromise = import('sharp')
      .then((m): SharpFactory | null => m.default)
      .catch((err: unknown) => {
        console.error('[hr-doc] sharp no disponible en este runtime:', err);
        return null;
      });
  }
  return sharpPromise;
}

export async function POST(request: Request) {
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

  // El permiso fino lo resuelve la base, con la misma regla que el panel.
  const { data: acceso } = await supabase.rpc('mi_acceso');
  const nivel = (acceso as Record<string, string> | null)?.['rrhh'];
  if (nivel !== 'edita') {
    return NextResponse.json({ error: 'Tu acceso a RRHH no permite subir papeles.' }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get('file');
  const empleadoId = String(form.get('empleado_id') ?? '');
  const tipo = String(form.get('tipo') ?? 'otro');
  const nombre = String(form.get('nombre') ?? '').trim();

  if (!UUID_RE.test(empleadoId)) {
    return NextResponse.json({ error: 'Empleado inválido.' }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Falta el archivo.' }, { status: 400 });
  }
  if (file.size > MAX_RAW_BYTES) {
    return NextResponse.json({ error: 'El archivo pasa de 4 MB.' }, { status: 413 });
  }

  const raw = Buffer.from(await file.arrayBuffer());
  const kind = sniffKind(raw);
  if (!kind) {
    return NextResponse.json(
      { error: 'Solo se aceptan fotos (JPG, PNG, WEBP) o PDF.' },
      { status: 415 },
    );
  }

  let cuerpo = raw;
  let ext = 'pdf';
  let contentType = 'application/pdf';

  if (kind !== 'pdf') {
    const sharp = await loadSharp();
    if (!sharp) {
      return NextResponse.json(
        { error: 'No podemos procesar imágenes ahora. Subí el papel en PDF.' },
        { status: 503 },
      );
    }
    // Reprocesar borra los metadatos y acota el tamaño.
    cuerpo = await sharp(raw)
      .rotate()
      .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    ext = 'jpg';
    contentType = 'image/jpeg';
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

  const path = `hr/${empleadoId}/${randomUUID()}.${ext}`;
  const { error: upErr } = await admin.storage
    .from('hr-docs')
    .upload(path, cuerpo, { contentType, upsert: false });
  if (upErr) {
    console.error('[hr-doc] no se pudo subir:', upErr);
    return NextResponse.json({ error: 'No pudimos guardar el archivo.' }, { status: 500 });
  }

  // La ficha se crea con la sesión de la persona, no con la clave de servicio:
  // así el guardián de solo lectura y la auditoría ven quién lo hizo.
  const { error: rpcErr } = await supabase.rpc('admin_guardar_hr_documento', {
    p_empleado_id: empleadoId,
    p_tipo: tipo,
    p_nombre: nombre || file.name,
    p_storage_path: path,
  });
  if (rpcErr) {
    // Si la ficha no se pudo crear, el archivo no tiene por qué quedar suelto.
    await admin.storage.from('hr-docs').remove([path]);
    return NextResponse.json({ error: 'No pudimos registrar el documento.' }, { status: 400 });
  }

  return NextResponse.json({ ok: true, path });
}
