'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { PaymentInstructionsSetting } from '@/lib/db-types';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';
import { DEFAULT_WA_TEMPLATES, type WhatsappTemplates } from '@/features/admin/lib/whatsapp';
import { Spinner, btnPrimary, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { useToast } from '@/features/admin/ui/toast';

interface ReserveAmount {
  type: 'fijo' | 'porcentaje' | 'total';
  value?: number;
  currency?: 'USD' | 'BOB';
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const QR_PATH = 'qr.png';

function Section({
  title,
  children,
  onSave,
  saving,
}: {
  title: string;
  children: React.ReactNode;
  onSave?: () => void;
  saving?: boolean;
}) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4">
      <h2 className="text-sm font-bold text-stone-900">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
      {onSave ? (
        <div className="mt-4 flex justify-end">
          <button type="button" disabled={saving} className={btnPrimary} onClick={onSave}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-stone-700">{label}</label>
      {children}
      {hint ? <p className="mt-1 text-xs text-stone-400">{hint}</p> : null}
    </div>
  );
}

export default function SettingsClient() {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();

  const [loading, setLoading] = useState(true);
  const [savingSection, setSavingSection] = useState<string | null>(null);

  // Reserva
  const [holdHours, setHoldHours] = useState(48);
  const [retryHours, setRetryHours] = useState(24);
  const [graceMinutes, setGraceMinutes] = useState(10);
  const [maxPerCi, setMaxPerCi] = useState(1);
  const [reserveAmount, setReserveAmount] = useState<ReserveAmount>({
    type: 'fijo',
    value: 1000,
    currency: 'BOB',
  });
  // Pagos
  const [exchangeRate, setExchangeRate] = useState(6.96);
  const [instructions, setInstructions] = useState<PaymentInstructionsSetting>({
    bank_name: '',
    account_holder: '',
    account_masked: '',
    qr_image_path: null,
    note: '',
  });
  const [qrPreview, setQrPreview] = useState<string | null>(null);
  const [qrUploading, setQrUploading] = useState(false);
  // Notificaciones
  const [emails, setEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [waTpl, setWaTpl] = useState<WhatsappTemplates>(DEFAULT_WA_TEMPLATES);
  // Sistema
  const [appBaseUrl, setAppBaseUrl] = useState<string | null>(null);
  const [captchaEnabled, setCaptchaEnabled] = useState(false);

  const refreshQrPreview = useCallback(
    async (path: string | null) => {
      if (!path) {
        setQrPreview(null);
        return;
      }
      const { data } = await supabase.storage.from('bank-assets').createSignedUrl(path, 300);
      setQrPreview(data?.signedUrl ?? null);
    },
    [supabase],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      // Global scope (project_id null) — the panel edits the global defaults.
      const { data } = await supabase.from('settings').select('key, value').is('project_id', null);
      if (!alive) return;
      const map = new Map<string, unknown>((data ?? []).map((r) => [r.key as string, r.value]));

      const num = (k: string, fallback: number) => {
        const v = map.get(k);
        return typeof v === 'number' ? v : typeof v === 'string' ? Number(v) || fallback : fallback;
      };
      setHoldHours(num('hold_hours', 48));
      setRetryHours(num('retry_hours', 24));
      setGraceMinutes(num('expiry_grace_minutes', 10));
      setMaxPerCi(num('max_active_per_ci', 1));
      setExchangeRate(num('exchange_rate_bob_per_usd', 6.96));

      const ra = map.get('reserve_amount') as ReserveAmount | undefined;
      if (ra && typeof ra === 'object') setReserveAmount({ currency: 'BOB', value: 0, ...ra });

      const pi = map.get('payment_instructions') as Partial<PaymentInstructionsSetting> | undefined;
      if (pi && typeof pi === 'object') {
        setInstructions({ qr_image_path: null, bank_name: '', account_holder: '', account_masked: '', note: '', ...pi });
        void refreshQrPreview(pi.qr_image_path ?? null);
      }

      const ne = map.get('notification_emails');
      if (Array.isArray(ne)) setEmails(ne.filter((e): e is string => typeof e === 'string'));

      const wt = map.get('whatsapp_templates') as Partial<WhatsappTemplates> | undefined;
      if (wt && typeof wt === 'object') setWaTpl({ ...DEFAULT_WA_TEMPLATES, ...wt });

      const abu = map.get('app_base_url');
      setAppBaseUrl(typeof abu === 'string' && abu ? abu : null);
      setCaptchaEnabled(map.get('captcha_enabled') === true);

      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [supabase, refreshQrPreview]);

  const saveKeys = useCallback(
    async (section: string, entries: [string, unknown][]) => {
      setSavingSection(section);
      for (const [key, value] of entries) {
        const { error } = await supabase.rpc('update_setting', {
          p_project_id: null,
          p_key: key,
          p_value: value,
        });
        if (error) {
          push(adminErrorCopy(error.message), 'error');
          setSavingSection(null);
          return false;
        }
      }
      push('Configuración guardada.', 'success');
      setSavingSection(null);
      return true;
    },
    [supabase, push],
  );

  async function uploadQr(file: File) {
    setQrUploading(true);
    try {
      const { error } = await supabase.storage
        .from('bank-assets')
        .upload(QR_PATH, file, { upsert: true, contentType: file.type || 'image/png' });
      if (error) {
        push('No se pudo subir el QR. Verifica que eres administrador.', 'error');
        return;
      }
      const next = { ...instructions, qr_image_path: QR_PATH };
      setInstructions(next);
      const { error: err2 } = await supabase.rpc('update_setting', {
        p_project_id: null,
        p_key: 'payment_instructions',
        p_value: next,
      });
      if (err2) {
        push(adminErrorCopy(err2.message), 'error');
        return;
      }
      push('QR actualizado.', 'success');
      void refreshQrPreview(QR_PATH);
    } finally {
      setQrUploading(false);
    }
  }

  function addEmail() {
    const e = newEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) {
      push('Correo inválido.', 'error');
      return;
    }
    if (emails.includes(e)) return;
    setEmails((prev) => [...prev, e]);
    setNewEmail('');
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner label="Cargando configuración…" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-lg font-bold text-stone-900">Configuración</h1>

      {/* ---- Reserva ---- */}
      <Section
        title="Reserva"
        saving={savingSection === 'reserva'}
        onSave={() =>
          void saveKeys('reserva', [
            ['hold_hours', holdHours],
            ['retry_hours', retryHours],
            ['expiry_grace_minutes', graceMinutes],
            ['max_active_per_ci', maxPerCi],
            [
              'reserve_amount',
              reserveAmount.type === 'total'
                ? { type: 'total' }
                : reserveAmount.type === 'porcentaje'
                  ? { type: 'porcentaje', value: reserveAmount.value ?? 0 }
                  : { type: 'fijo', value: reserveAmount.value ?? 0, currency: reserveAmount.currency ?? 'BOB' },
            ],
          ])
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Horas de reserva" hint="Plazo para pagar la seña">
            <input type="number" min={1} max={720} value={holdHours} onChange={(e) => setHoldHours(Number(e.target.value))} className={inputClass} />
          </Field>
          <Field label="Horas de reintento" hint="Tras un rechazo con reintento">
            <input type="number" min={1} max={720} value={retryHours} onChange={(e) => setRetryHours(Number(e.target.value))} className={inputClass} />
          </Field>
          <Field label="Minutos de gracia" hint="Margen antes de expirar">
            <input type="number" min={0} max={120} value={graceMinutes} onChange={(e) => setGraceMinutes(Number(e.target.value))} className={inputClass} />
          </Field>
          <Field label="Reservas activas por CI">
            <input type="number" min={1} max={10} value={maxPerCi} onChange={(e) => setMaxPerCi(Number(e.target.value))} className={inputClass} />
          </Field>
        </div>
        <Field label="Monto de la seña">
          <div className="flex flex-wrap gap-2">
            <select
              value={reserveAmount.type}
              onChange={(e) => setReserveAmount((r) => ({ ...r, type: e.target.value as ReserveAmount['type'] }))}
              className={`${inputClass} w-auto`}
            >
              <option value="fijo">Monto fijo</option>
              <option value="porcentaje">Porcentaje del precio</option>
              <option value="total">Precio total</option>
            </select>
            {reserveAmount.type !== 'total' ? (
              <input
                type="number"
                min={0}
                step="0.01"
                value={reserveAmount.value ?? 0}
                onChange={(e) => setReserveAmount((r) => ({ ...r, value: Number(e.target.value) }))}
                className={`${inputClass} w-32`}
              />
            ) : null}
            {reserveAmount.type === 'fijo' ? (
              <select
                value={reserveAmount.currency ?? 'BOB'}
                onChange={(e) => setReserveAmount((r) => ({ ...r, currency: e.target.value as 'USD' | 'BOB' }))}
                className={`${inputClass} w-auto`}
              >
                <option value="BOB">Bs</option>
                <option value="USD">$us</option>
              </select>
            ) : null}
            {reserveAmount.type === 'porcentaje' ? <span className="self-center text-sm text-stone-500">%</span> : null}
          </div>
        </Field>
      </Section>

      {/* ---- Pagos ---- */}
      <Section
        title="Pagos"
        saving={savingSection === 'pagos'}
        onSave={() =>
          void saveKeys('pagos', [
            ['exchange_rate_bob_per_usd', exchangeRate],
            ['payment_instructions', instructions],
          ])
        }
      >
        <Field label="Tipo de cambio (Bs por $us)">
          <input type="number" min={0} step="0.0001" value={exchangeRate} onChange={(e) => setExchangeRate(Number(e.target.value))} className={inputClass} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Banco">
            <input value={instructions.bank_name} onChange={(e) => setInstructions((i) => ({ ...i, bank_name: e.target.value }))} className={inputClass} />
          </Field>
          <Field label="Titular de la cuenta">
            <input value={instructions.account_holder} onChange={(e) => setInstructions((i) => ({ ...i, account_holder: e.target.value }))} className={inputClass} />
          </Field>
        </div>
        <Field label="Cuenta (visible al comprador)" hint="Ej: ****-1234">
          <input value={instructions.account_masked} onChange={(e) => setInstructions((i) => ({ ...i, account_masked: e.target.value }))} className={inputClass} />
        </Field>
        <Field label="Nota para el comprador">
          <textarea rows={2} value={instructions.note} onChange={(e) => setInstructions((i) => ({ ...i, note: e.target.value }))} className={inputClass} />
        </Field>
        <Field label="Imagen del QR de cobro" hint="Se muestra al comprador al reservar (JPG/PNG/WebP, máx 5 MB)">
          <div className="flex items-center gap-3">
            {qrPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrPreview} alt="QR de cobro actual" className="h-24 w-24 rounded-lg border border-stone-200 object-contain" />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-stone-300 text-xs text-stone-400">
                Sin QR
              </div>
            )}
            <label className={btnSecondary}>
              {qrUploading ? 'Subiendo…' : qrPreview ? 'Reemplazar QR' : 'Subir QR'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                disabled={qrUploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadQr(f);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        </Field>
      </Section>

      {/* ---- Notificaciones ---- */}
      <Section
        title="Notificaciones"
        saving={savingSection === 'notificaciones'}
        onSave={() =>
          void saveKeys('notificaciones', [
            ['notification_emails', emails],
            ['whatsapp_templates', waTpl],
          ])
        }
      >
        <Field label="Correos del equipo" hint="Reciben aviso de nuevas reservas y comprobantes">
          <div className="space-y-2">
            {emails.map((e) => (
              <div key={e} className="flex items-center justify-between rounded-lg border border-stone-200 px-3 py-1.5 text-sm">
                <span className="truncate">{e}</span>
                <button
                  type="button"
                  onClick={() => setEmails((prev) => prev.filter((x) => x !== e))}
                  className="text-xs font-medium text-red-600 hover:underline"
                >
                  Quitar
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addEmail();
                  }
                }}
                placeholder="correo@ejemplo.com"
                className={inputClass}
              />
              <button type="button" className={btnSecondary} onClick={addEmail}>
                Agregar
              </button>
            </div>
          </div>
        </Field>
        <Field label="Plantilla WhatsApp — contacto" hint="Variables: {nombre} {codigo} {lote} {manzana}">
          <textarea rows={3} value={waTpl.contacto} onChange={(e) => setWaTpl((t) => ({ ...t, contacto: e.target.value }))} className={inputClass} />
        </Field>
        <Field label="Plantilla WhatsApp — rechazo" hint="Variables: {nombre} {codigo} {motivo}">
          <textarea rows={3} value={waTpl.rechazo} onChange={(e) => setWaTpl((t) => ({ ...t, rechazo: e.target.value }))} className={inputClass} />
        </Field>
      </Section>

      {/* ---- Sistema ---- */}
      <Section
        title="Sistema"
        saving={savingSection === 'sistema'}
        onSave={() => void saveKeys('sistema', [['captcha_enabled', captchaEnabled]])}
      >
        <Field label="URL base de la aplicación" hint="Se configura en el despliegue; usada en correos y avisos automáticos">
          <input value={appBaseUrl ?? 'no configurada'} readOnly className={`${inputClass} bg-stone-50 text-stone-500`} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={captchaEnabled}
            onChange={(e) => setCaptchaEnabled(e.target.checked)}
            className="accent-brand"
          />
          Exigir CAPTCHA al crear reservas
        </label>
      </Section>
    </div>
  );
}
