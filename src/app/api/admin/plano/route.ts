import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasSupabaseConfig } from '@/lib/supabase/config';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Encola la lectura de un plano y despierta al worker.
 *
 * No espera el resultado: leer un plano tarda ~130 s y una ruta de Next se
 * queda sin tiempo mucho antes. Invocar la función de Python es una invocación
 * aparte con su propio presupuesto, así que cortar este fetch no la mata — el
 * worker sigue y va escribiendo su avance en `plano_jobs`.
 *
 * La pantalla no depende de esta respuesta más que para saber qué trabajo
 * mirar: si el navegador se cierra, el trabajo continúa igual.
 */
export async function POST(req: NextRequest) {
  if (!hasSupabaseConfig) {
    return NextResponse.json({ error: 'Sin conexión a la base de datos.' }, { status: 503 });
  }

  let projectId: string | null = null;
  let storagePath: string | null = null;
  let sheetId: string | null = null;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (typeof body.projectId === 'string') projectId = body.projectId;
    if (typeof body.storagePath === 'string') storagePath = body.storagePath;
    if (typeof body.sheetId === 'string') sheetId = body.sheetId;
  } catch {
    // se valida abajo
  }
  if (!projectId || !UUID_RE.test(projectId)) {
    return NextResponse.json({ error: 'Parámetro projectId inválido.' }, { status: 400 });
  }
  if (!storagePath || storagePath.includes('..')) {
    return NextResponse.json({ error: 'Ruta de plano inválida.' }, { status: 400 });
  }

  // El RPC se autoriza solo (assert_admin) con la sesión de la persona: esta
  // ruta no decide permisos por su cuenta.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_encolar_plano', {
    p_project_id: projectId,
    p_storage_path: storagePath,
    p_sheet_id: sheetId,
  });

  if (error) {
    const copy: Record<string, string> = {
      NO_AUTORIZADO: 'Solo un administrador puede leer planos.',
      YA_HAY_UNO_EN_CURSO: 'Ya se está leyendo un plano de esta urbanización. Esperá a que termine.',
      PLANO_REQUERIDO: 'Falta el archivo del plano.',
      PROJECT_NOT_FOUND: 'La urbanización no existe.',
    };
    const clave = Object.keys(copy).find((k) => error.message.includes(k));
    return NextResponse.json(
      { error: clave ? copy[clave] : 'No se pudo encolar la lectura del plano.' },
      { status: clave === 'NO_AUTORIZADO' ? 403 : 400 },
    );
  }

  const jobId = (data as { job_id?: string } | null)?.job_id;
  if (!jobId) {
    return NextResponse.json({ error: 'No se pudo crear el trabajo.' }, { status: 500 });
  }

  // Despertar al worker sin esperarlo. Un timeout corto: solo hace falta que la
  // invocación arranque, y si tarda en responder no es asunto de esta ruta.
  const base = process.env.PLANO_WORKER_URL ?? new URL('/api/plano', req.url).origin + '/api/plano';
  void fetch(base, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.PLANO_WORKER_SECRET
        ? { 'X-Worker-Secret': process.env.PLANO_WORKER_SECRET }
        : {}),
    },
    body: JSON.stringify({ job_id: jobId }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {
    // Se ignora a propósito: el trabajo ya está encolado y su estado vive en la
    // base. Si el worker no arrancó, el job queda 'pendiente' y se ve en la
    // pantalla — es mejor eso que fingir un error que quizá no ocurrió.
  });

  return NextResponse.json({ jobId });
}
