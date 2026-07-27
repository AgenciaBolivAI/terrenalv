// POST /api/reservas/[code]/comprobante — server-proxied payment-proof upload.
// The proxy is what GUARANTEES privacy: images are re-encoded with sharp (EXIF/GPS
// stripped deterministically, longest side capped at 2000 px) before touching
// storage. The client never gets a direct upload credential.

import { NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { hashClientIp } from '@/lib/server/client-ip';
import { rpcErrorCode, rpcErrorCopy } from '@/lib/errors';
import { trackingCodeSchema } from '@/lib/validation';
import type { ReservationStatusPayload } from '@/lib/db-types';
import { safeDecode } from '@/features/reservations/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SERVICE_UNAVAILABLE = 'Servicio no disponible todavía';
// Matches the client cap. Vercel rejects bodies over 4.5 MB before this route
// even runs, so a higher number here would be a lie.
const MAX_RAW_BYTES = 4 * 1024 * 1024;
const MAX_PDF_BYTES = 5 * 1024 * 1024; // bucket limit (PDFs pass through untouched)

type Sniffed = 'jpeg' | 'png' | 'webp' | 'pdf';

/** Magic-byte sniffing — the client's declared MIME type is never trusted. */
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

function errorJson(message: string, code: string | null, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await ctx.params;
  const parsedCode = trackingCodeSchema.safeParse(safeDecode(rawCode));
  if (!parsedCode.success) {
    return errorJson('Código inválido (ej: EDS-7F3K-9Q2M)', 'INVALID_CODE', 400);
  }
  const code = parsedCode.data;

  // --- Read + sniff the file (fail fast, before any DB work) ---
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorJson('No recibimos el archivo. Intenta de nuevo.', 'BAD_REQUEST', 400);
  }
  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return errorJson('No recibimos el archivo. Intenta de nuevo.', 'BAD_REQUEST', 400);
  }
  if (file.size === 0) {
    return errorJson('El archivo está vacío. Intenta con otra foto.', 'EMPTY_FILE', 400);
  }
  if (file.size > MAX_RAW_BYTES) {
    return errorJson('El archivo pesa demasiado (máximo 4 MB).', 'FILE_TOO_LARGE', 413);
  }

  const raw = Buffer.from(await file.arrayBuffer());
  const kind = sniffKind(raw);
  if (!kind) {
    return errorJson(
      'Formato no permitido. Sube una foto (JPG, PNG o WebP) o un PDF.',
      'UNSUPPORTED_TYPE',
      415,
    );
  }
  if (kind === 'pdf' && raw.length > MAX_PDF_BYTES) {
    return errorJson('El PDF pesa demasiado (máximo 5 MB).', 'FILE_TOO_LARGE', 413);
  }

  let admin: SupabaseClient;
  try {
    admin = createAdminClient();
  } catch {
    return errorJson(SERVICE_UNAVAILABLE, 'SERVICE_UNAVAILABLE', 503);
  }

  try {
    const ipHash = hashClientIp(request.headers);

    // --- Confirm the reservation exists and is in an uploadable state ---
    const { data: statusData, error: statusError } = await admin.rpc('get_reservation_status', {
      p_tracking_code: code,
      p_ip_hash: ipHash,
    });
    if (statusError) {
      const errCode = rpcErrorCode(statusError.message);
      const http = errCode === 'RESERVATION_NOT_FOUND' ? 404 : errCode === 'RATE_LIMITED' ? 429 : 500;
      return errorJson(rpcErrorCopy(statusError.message), errCode, http);
    }
    const status = (statusData as ReservationStatusPayload | null)?.status;
    if (status !== 'pendiente_pago' && status !== 'rechazo_reintento') {
      const errCode = status === 'expirada' ? 'RESERVATION_EXPIRED' : 'RESERVATION_NOT_PENDING';
      return errorJson(rpcErrorCopy(errCode), errCode, 409);
    }

    // The status RPC does not expose the reservation UUID; the storage path needs it.
    const { data: resRow, error: resError } = await admin
      .from('reservations')
      .select('id')
      .eq('tracking_code', code)
      .single();
    if (resError || !resRow) {
      return errorJson(rpcErrorCopy('RESERVATION_NOT_FOUND'), 'RESERVATION_NOT_FOUND', 404);
    }
    const reservationId = resRow.id as string;

    // --- Normalize the bytes ---
    let finalBytes: Buffer;
    let ext: 'jpg' | 'pdf';
    let contentType: string;
    if (kind === 'pdf') {
      finalBytes = raw;
      ext = 'pdf';
      contentType = 'application/pdf';
    } else {
      try {
        // .rotate() applies EXIF orientation; the re-encode (no withMetadata)
        // strips EXIF/GPS/ICC deterministically.
        finalBytes = await sharp(raw)
          .rotate()
          .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 82, mozjpeg: true })
          .toBuffer();
      } catch {
        return errorJson(
          'No pudimos procesar la imagen. Intenta con otra foto o con un PDF.',
          'IMAGE_PROCESSING_FAILED',
          415,
        );
      }
      ext = 'jpg';
      contentType = 'image/jpeg';
    }
    if (finalBytes.length > MAX_PDF_BYTES) {
      return errorJson('El archivo pesa demasiado (máximo 5 MB).', 'FILE_TOO_LARGE', 413);
    }

    const sha256 = createHash('sha256').update(finalBytes).digest('hex');
    const storagePath = `${reservationId}/${randomUUID()}.${ext}`;

    // --- Upload, then flip state atomically via the RPC ---
    const { error: uploadError } = await admin.storage
      .from('payment-proofs')
      .upload(storagePath, finalBytes, { contentType, upsert: false });
    if (uploadError) {
      return errorJson('No pudimos guardar tu comprobante. Intenta de nuevo.', 'UPLOAD_FAILED', 502);
    }

    const { error: rpcError } = await admin.rpc('submit_payment_proof', {
      p_tracking_code: code,
      p_storage_path: storagePath,
      p_sha256: sha256,
      p_ip_hash: ipHash,
    });
    if (rpcError) {
      // Best-effort cleanup of the orphaned object.
      try {
        await admin.storage.from('payment-proofs').remove([storagePath]);
      } catch {
        /* ignore */
      }
      const errCode = rpcErrorCode(rpcError.message);
      const http =
        errCode === 'RESERVATION_NOT_FOUND'
          ? 404
          : errCode === 'RESERVATION_EXPIRED' || errCode === 'RESERVATION_NOT_PENDING'
            ? 409
            : 400;
      return errorJson(rpcErrorCopy(rpcError.message), errCode, http);
    }

    return NextResponse.json({ status: 'en_verificacion' });
  } catch {
    return errorJson(SERVICE_UNAVAILABLE, 'SERVICE_UNAVAILABLE', 503);
  }
}
