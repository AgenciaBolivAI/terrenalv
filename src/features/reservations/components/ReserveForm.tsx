'use client';

// Guest reservation form: nombre, CI (+ complemento opcional), celular (+591),
// correo opcional, términos. Validates with the SAME zod schema the API uses
// (instant UX; the database re-validates everything anyway).

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { reserveFormSchema } from '@/lib/validation';
import {
  clearFormDraft,
  getFormDraft,
  saveActiveReservation,
  saveFormDraft,
} from '@/lib/client/session-state';
import type { CreateReservationResponse, ReservationApiError } from '../lib/api';
import { TurnstileWidget, type TurnstileHandle } from './TurnstileWidget';

type FieldErrors = Partial<Record<'full_name' | 'ci' | 'phone' | 'email' | 'accept_terms', string>>;

// Width lives at the call site, never in the base. Appending `flex-1` or `w-24`
// to a class string that already contains `w-full` produces two competing width
// utilities, and CSS source order decides the winner — not the order you wrote
// them. That is what collapsed the CI field to a sliver and let the 2-character
// complemento take the row, so a carnet number could not be typed at all.
// `text-base` (16px) is also deliberate: iOS zooms the page on focus below that.
const inputBase =
  'rounded-xl border border-stone-300 bg-white px-3 py-3 text-base text-stone-900 outline-none placeholder:text-stone-400 focus:border-brand-light focus:ring-2 focus:ring-green-100';
const inputClass = `w-full ${inputBase}`;

export function ReserveForm({
  lotId,
  mapHref,
  lotLabel,
}: {
  lotId: string;
  mapHref: string;
  lotLabel?: string;
}) {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [ci, setCi] = useState('');
  const [comp, setComp] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [terms, setTerms] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverErrorCode, setServerErrorCode] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const restored = useRef(false);
  const turnstileRef = useRef<TurnstileHandle | null>(null);

  // Restore the draft once (mobile browsers kill the tab during the bank round-trip).
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const draft = getFormDraft();
    if (!draft) return;
    if (draft.full_name) setFullName(draft.full_name);
    if (draft.ci) {
      const [num, c] = draft.ci.split('-');
      setCi(num ?? '');
      if (c) setComp(c);
    }
    if (draft.phone) setPhone(draft.phone);
    if (draft.email) setEmail(draft.email);
  }, []);

  // Persist the draft as they type (debounced).
  useEffect(() => {
    if (!restored.current) return;
    const t = setTimeout(() => {
      if (fullName || ci || phone || email) {
        saveFormDraft({
          full_name: fullName,
          ci: ci + (comp ? `-${comp.toUpperCase()}` : ''),
          phone,
          email,
        });
      }
    }, 400);
    return () => clearTimeout(t);
  }, [fullName, ci, comp, phone, email]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sending) return;
    setServerError(null);
    setServerErrorCode(null);

    const mergedCi = ci + (comp ? `-${comp.toUpperCase()}` : '');
    const parsed = reserveFormSchema.safeParse({
      lot_id: lotId,
      full_name: fullName,
      ci: mergedCi,
      phone,
      email,
      accept_terms: terms,
    });
    if (!parsed.success) {
      const errs: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string' && !(key in errs)) {
          errs[key as keyof FieldErrors] = issue.message;
        }
      }
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    setSending(true);
    try {
      const res = await fetch('/api/reservas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          lot_id: lotId,
          full_name: fullName,
          ci: mergedCi,
          phone,
          email,
          accept_terms: terms,
          ...(token ? { turnstileToken: token } : {}),
        }),
      });
      const json: (Partial<CreateReservationResponse> & Partial<ReservationApiError>) | null =
        await res.json().catch(() => null);
      if (!res.ok || !json?.tracking_code) {
        setServerError(json?.error ?? 'Ocurrió un error. Intenta de nuevo.');
        setServerErrorCode(json?.code ?? null);
        setSending(false);
        // Turnstile tokens are single-use: without a reset every retry after a
        // server error would fail with CAPTCHA_FAILED.
        turnstileRef.current?.reset();
        return;
      }
      // The reservation is now this device's session anchor; the draft is done.
      saveActiveReservation({
        code: json.tracking_code,
        lotLabel: lotLabel ?? json.reference_code ?? '',
        status: 'pendiente_pago',
      });
      clearFormDraft();
      router.push(`/reserva/${encodeURIComponent(json.tracking_code)}?nuevo=1`);
    } catch {
      setServerError('Sin conexión. Revisa tu internet e intenta de nuevo.');
      setSending(false);
      turnstileRef.current?.reset();
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div>
        <label htmlFor="rf-nombre" className="mb-1 block text-sm font-semibold text-stone-700">
          Nombre completo
        </label>
        <input
          id="rf-nombre"
          autoComplete="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Como figura en tu carnet"
          className={inputClass}
        />
        {fieldErrors.full_name ? (
          <p className="mt-1 text-xs text-red-600">{fieldErrors.full_name}</p>
        ) : null}
      </div>

      <div>
        <label htmlFor="rf-ci" className="mb-1 block text-sm font-semibold text-stone-700">
          Carnet de identidad
        </label>
        <div className="flex gap-2">
          <input
            id="rf-ci"
            inputMode="numeric"
            autoComplete="off"
            value={ci}
            onChange={(e) => setCi(e.target.value.replace(/[^0-9]/g, ''))}
            maxLength={10}
            placeholder="7896541"
            className={`${inputBase} min-w-0 flex-1`}
          />
          <input
            aria-label="Complemento del carnet (opcional)"
            value={comp}
            onChange={(e) => setComp(e.target.value.replace(/[^0-9a-zA-Z]/g, '').toUpperCase())}
            maxLength={2}
            placeholder="Compl."
            className={`${inputBase} w-24 shrink-0`}
          />
        </div>
        <p className="mt-1 text-xs text-stone-500">El complemento (ej. 1E) es opcional.</p>
        {fieldErrors.ci ? <p className="mt-1 text-xs text-red-600">{fieldErrors.ci}</p> : null}
      </div>

      <div>
        <label htmlFor="rf-cel" className="mb-1 block text-sm font-semibold text-stone-700">
          Celular (WhatsApp)
        </label>
        <div className="flex items-stretch gap-2">
          <span className="flex shrink-0 items-center rounded-xl border border-stone-200 bg-stone-100 px-3 text-base font-semibold text-stone-600">
            +591
          </span>
          <input
            id="rf-cel"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, ''))}
            maxLength={8}
            placeholder="70000000"
            className={`${inputBase} min-w-0 flex-1`}
          />
        </div>
        {fieldErrors.phone ? <p className="mt-1 text-xs text-red-600">{fieldErrors.phone}</p> : null}
      </div>

      <div>
        <label htmlFor="rf-email" className="mb-1 block text-sm font-semibold text-stone-700">
          Correo electrónico <span className="font-normal text-stone-400">(opcional)</span>
        </label>
        <input
          id="rf-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tucorreo@ejemplo.com"
          className={inputClass}
        />
        {fieldErrors.email ? <p className="mt-1 text-xs text-red-600">{fieldErrors.email}</p> : null}
      </div>

      <details
        id="terminos"
        className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm text-stone-600"
      >
        <summary className="cursor-pointer font-semibold text-stone-700">
          Términos de reserva (versión preliminar)
        </summary>
        <div className="mt-2 space-y-2">
          <p>1. La reserva se asegura con el pago de una seña dentro del plazo de 48 horas.</p>
          <p>2. La seña se aplica íntegramente al precio total del lote.</p>
          <p>
            3. Si el pago no se completa dentro del plazo, la reserva expira y el lote vuelve a
            estar disponible.
          </p>
          <p>
            4. La seña no es reembolsable, salvo que el comprobante sea rechazado y no sea posible
            completar el proceso de verificación.
          </p>
          <p>
            5. Documento preliminar: el contrato definitivo de compraventa se firma en oficinas de
            Terrenalv S.R.L.
          </p>
        </div>
      </details>

      <label className="flex items-start gap-3 rounded-xl p-1" htmlFor="rf-terms">
        <input
          id="rf-terms"
          type="checkbox"
          checked={terms}
          onChange={(e) => setTerms(e.target.checked)}
          className="mt-1 h-5 w-5 shrink-0 accent-brand"
        />
        <span className="text-sm text-stone-700">
          Acepto los{' '}
          <a href="#terminos" className="font-semibold text-brand underline">
            términos de reserva
          </a>
        </span>
      </label>
      {fieldErrors.accept_terms ? (
        <p className="-mt-2 text-xs text-red-600">{fieldErrors.accept_terms}</p>
      ) : null}

      <TurnstileWidget onToken={setToken} handleRef={turnstileRef} />

      {serverError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-700">{serverError}</p>
          {serverErrorCode === 'LOT_NOT_AVAILABLE' ? (
            <Link
              href={mapHref}
              className="mt-2 inline-block text-sm font-bold text-brand underline"
            >
              Volver al mapa
            </Link>
          ) : null}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={sending}
        className="w-full rounded-xl bg-brand px-4 py-4 text-base font-bold text-white shadow-sm transition-colors active:bg-brand-light disabled:opacity-60"
      >
        {sending ? 'Reservando…' : 'Reservar este lote'}
      </button>
      <p className="text-center text-xs text-stone-500">
        Al reservar recibirás un código de seguimiento y las instrucciones de pago.
      </p>
    </form>
  );
}
