'use client';

// Payment-proof upload zone. Images are pre-compressed in the browser
// (faster on mobile data) and ALWAYS re-encoded server-side (EXIF/GPS stripped
// there — the browser step is purely bandwidth). Retry is safe: the server
// generates a fresh object path per attempt and the RPC is idempotent-friendly.

import { useRef, useState } from 'react';
import imageCompression from 'browser-image-compression';

type Phase = 'idle' | 'comprimiendo' | 'subiendo' | 'error';

// Vercel caps a serverless request body at 4.5 MB and rejects it BEFORE the
// route runs — a larger body 413s with an opaque error the buyer can't act on.
// Stay under it so the failure is a clear Spanish message instead.
const MAX_SEND_BYTES = 4 * 1024 * 1024;

export function ProofUploader({
  code,
  onUploaded,
  heading = 'Sube tu comprobante',
}: {
  code: string;
  onUploaded: () => void;
  heading?: string;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const lastFileRef = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const busy = phase === 'comprimiendo' || phase === 'subiendo';

  async function send(file: File) {
    lastFileRef.current = file;
    setError(null);

    let toSend: Blob = file;
    if (file.type.startsWith('image/')) {
      setPhase('comprimiendo');
      try {
        toSend = await imageCompression(file, {
          maxWidthOrHeight: 1600,
          maxSizeMB: 0.5,
          useWebWorker: true,
        });
      } catch {
        toSend = file; // the server re-encodes anyway
      }
    }
    if (toSend.size > MAX_SEND_BYTES) {
      setPhase('error');
      setError(
        file.type === 'application/pdf'
          ? 'El PDF pesa demasiado (máximo 4 MB). Envía una captura de pantalla del pago.'
          : 'El archivo pesa demasiado (máximo 4 MB). Prueba con una foto más liviana.',
      );
      return;
    }

    setPhase('subiendo');
    try {
      const fd = new FormData();
      fd.append('file', toSend, file.name || 'comprobante');
      const res = await fetch(`/api/reservas/${encodeURIComponent(code)}/comprobante`, {
        method: 'POST',
        body: fd,
      });
      const json: { error?: string } | null = await res.json().catch(() => null);
      if (!res.ok) {
        // 409: la reserva ya no espera pago. En un reintento eso NO es un
        // error: es que el envío anterior sí llegó y el comprobante ya está en
        // revisión. Se trata como lo que es — una carrera ganada.
        if (res.status === 409) {
          setPhase('idle');
          lastFileRef.current = null;
          onUploaded();
          return;
        }
        setPhase('error');
        setError(json?.error ?? 'No pudimos subir el comprobante. Intenta de nuevo.');
        return;
      }
      setPhase('idle');
      lastFileRef.current = null;
      onUploaded();
    } catch {
      setPhase('error');
      // No se puede afirmar que no se envió: la conexión pudo cortarse DESPUÉS
      // de que el servidor lo guardara.
      setError(
        'Se cortó la conexión. Puede que tu comprobante sí haya llegado: actualizá esta página antes de volver a subirlo.',
      );
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void send(file);
  }

  return (
    <section className="rounded-2xl border-2 border-dashed border-brand-light/60 bg-green-50/40 p-4">
      <h3 className="text-sm font-bold uppercase tracking-wide text-brand">{heading}</h3>
      <p className="mt-1 text-sm text-stone-600">
        Foto o captura de la transferencia (JPG, PNG) o PDF del banco.
      </p>

      <input
        ref={inputRef}
        id="proof-file"
        type="file"
        accept="image/*,.pdf,application/pdf"
        className="sr-only"
        onChange={onPick}
        disabled={busy}
      />

      {busy ? (
        <div className="mt-3 rounded-xl bg-white p-4 text-center">
          <div className="mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-brand-light border-t-transparent" />
          <p className="text-sm font-semibold text-stone-700">
            {phase === 'comprimiendo' ? 'Preparando la imagen…' : 'Subiendo tu comprobante…'}
          </p>
          <p className="mt-1 text-xs text-stone-500">No cierres esta página.</p>
        </div>
      ) : (
        <label
          htmlFor="proof-file"
          className="mt-3 block w-full cursor-pointer rounded-xl bg-brand px-4 py-3.5 text-center text-base font-bold text-white shadow-sm transition-colors active:bg-brand-light"
        >
          Subir comprobante
        </label>
      )}

      {phase === 'error' && error ? (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-700">{error}</p>
          {lastFileRef.current ? (
            <button
              type="button"
              onClick={() => lastFileRef.current && void send(lastFileRef.current)}
              className="mt-2 w-full rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-bold text-red-700 active:bg-red-100"
            >
              Reintentar
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
