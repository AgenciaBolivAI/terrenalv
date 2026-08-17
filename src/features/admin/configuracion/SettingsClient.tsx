'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { PaymentInstructionsSetting } from '@/lib/db-types';
import { computeFinancing, formatPct, formatTerm, parseFinancingPlan, type FinancingPlan } from '@/lib/financing';
import { formatMoney } from '@/lib/format';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';
import { DEFAULT_WA_TEMPLATES, type WhatsappTemplates } from '@/features/admin/lib/whatsapp';
import { Spinner, btnPrimary, btnSecondary, inputBase, inputClass } from '@/features/admin/ui/bits';
import { useToast } from '@/features/admin/ui/toast';

interface ReserveAmount {
  type: 'fijo' | 'porcentaje' | 'total';
  value?: number;
  currency?: 'USD' | 'BOB';
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const QR_PATH = 'qr.png';

/** Shown to the buyer when no custom note is written. */
const DEFAULT_FINANCING_NOTE = 'Plan referencial. El plan definitivo se confirma en oficina.';

const DEFAULT_FINANCING: FinancingPlan = {
  enabled: false,
  down_payment_type: 'porcentaje',
  down_payment_value: 30,
  months: 36,
  annual_interest_pct: 0,
  note: DEFAULT_FINANCING_NOTE,
};

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
  // Financiamiento
  const [financing, setFinancing] = useState<FinancingPlan>(DEFAULT_FINANCING);
  const [samplePrice, setSamplePrice] = useState(7500);
  const [currency, setCurrency] = useState<'USD' | 'BOB'>('BOB');
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

      // parseFinancingPlan returns null when disabled, so keep the raw values
      // in the form — turning the plan off must not erase the terms.
      const fpRaw = map.get('financing_plan');
      const fp = parseFinancingPlan({ ...(fpRaw as object | null), enabled: true });
      if (fp) {
        setFinancing({
          ...fp,
          enabled: (fpRaw as { enabled?: unknown } | undefined)?.enabled === true,
        });
      }

      const abu = map.get('app_base_url');
      setAppBaseUrl(typeof abu === 'string' && abu ? abu : null);
      setCaptchaEnabled(map.get('captcha_enabled') === true);

      const { data: proj } = await supabase.from('projects').select('currency').limit(1).maybeSingle();
      if (!alive) return;
      if (proj?.currency === 'USD' || proj?.currency === 'BOB') setCurrency(proj.currency);

      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [supabase, refreshQrPreview]);

  // `isPublic` is only passed where anon must read the value (the map reads the
  // payment plan); null leaves the existing visibility untouched.
  const saveKeys = useCallback(
    async (section: string, entries: [string, unknown, boolean?][]) => {
      setSavingSection(section);
      for (const [key, value, isPublic] of entries) {
        const { error } = await supabase.rpc('update_setting', {
          p_project_id: null,
          p_key: key,
          p_value: value,
          p_is_public: isPublic ?? null,
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
              className={`${inputBase} w-auto`}
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
                className={`${inputBase} w-32`}
              />
            ) : null}
            {reserveAmount.type === 'fijo' ? (
              <select
                value={reserveAmount.currency ?? 'BOB'}
                onChange={(e) => setReserveAmount((r) => ({ ...r, currency: e.target.value as 'USD' | 'BOB' }))}
                className={`${inputBase} w-auto`}
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

      {/* ---- Financiamiento ---- */}
      <Section
        title="Plan de pago"
        saving={savingSection === 'financiamiento'}
        onSave={() =>
          void saveKeys(
            'financiamiento',
            [['financing_plan', { ...financing, note: financing.note || DEFAULT_FINANCING_NOTE }, true]],
          )
        }
      >
        <p className="text-xs text-stone-500">
          El comprador ve la cuota inicial y la cuota mensual calculadas sobre el precio de cada
          lote, en el mapa y al reservar. No genera cuotas ni estados de cuenta: es informativo.
        </p>

        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={financing.enabled}
            onChange={(e) => setFinancing((f) => ({ ...f, enabled: e.target.checked }))}
            className="accent-brand"
          />
          Mostrar el plan de pago al comprador
        </label>

        <Field label="Cuota inicial">
          <div className="flex flex-wrap gap-2">
            <select
              value={financing.down_payment_type}
              onChange={(e) =>
                setFinancing((f) => ({
                  ...f,
                  down_payment_type: e.target.value as FinancingPlan['down_payment_type'],
                }))
              }
              className={`${inputBase} w-auto`}
            >
              <option value="porcentaje">Porcentaje del precio</option>
              <option value="fijo">Monto fijo</option>
            </select>
            <input
              type="number"
              min={0}
              step="0.01"
              value={financing.down_payment_value}
              onChange={(e) =>
                setFinancing((f) => ({ ...f, down_payment_value: Number(e.target.value) }))
              }
              className={`${inputBase} w-32`}
            />
            {/* A fixed cuota inicial is quoted in bolivianos while the lots are
                priced in dólares, so its currency is its own field. */}
            {financing.down_payment_type === 'porcentaje' ? (
              <span className="self-center text-sm text-stone-500">%</span>
            ) : (
              <select
                value={financing.down_payment_currency ?? currency}
                onChange={(e) =>
                  setFinancing((f) => ({
                    ...f,
                    down_payment_currency: e.target.value as 'USD' | 'BOB',
                  }))
                }
                className={`${inputBase} w-auto`}
                aria-label="Moneda de la cuota inicial"
              >
                <option value="BOB">Bs</option>
                <option value="USD">$us</option>
              </select>
            )}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Plazo (meses)" hint="En cuántas cuotas se paga el saldo (120 = 10 años)">
            <input
              type="number"
              min={1}
              max={600}
              value={financing.months}
              onChange={(e) => setFinancing((f) => ({ ...f, months: Number(e.target.value) }))}
              className={inputClass}
            />
          </Field>
          <Field
            label="Cuota mensual mínima"
            hint="Lo único que se publica. Al ponerla, la web deja de mostrar plazo e interés — eso se acuerda en oficina."
          >
            <div className="flex flex-wrap gap-2">
              <input
                type="number"
                min={0}
                step="1"
                value={financing.min_monthly ?? ''}
                onChange={(e) =>
                  setFinancing((f) => ({
                    ...f,
                    min_monthly: e.target.value === '' ? undefined : Number(e.target.value),
                  }))
                }
                placeholder="sin mínimo"
                className={`${inputBase} w-32`}
              />
              <span className="self-center text-sm text-stone-500">
                {financing.down_payment_currency ?? currency}
              </span>
            </div>
          </Field>

          <Field label="Interés anual (%)" hint="Uso interno: no se publica si hay cuota mínima">
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={financing.annual_interest_pct}
              onChange={(e) =>
                setFinancing((f) => ({ ...f, annual_interest_pct: Number(e.target.value) }))
              }
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Nota para el comprador" hint="Aparece bajo el plan de pago">
          <input
            value={financing.note ?? ''}
            onChange={(e) => setFinancing((f) => ({ ...f, note: e.target.value }))}
            placeholder={DEFAULT_FINANCING_NOTE}
            className={inputClass}
          />
        </Field>

        {/* Lo que verá el comprador, con los valores del formulario. */}
        <Field label="Vista previa" hint="Escribe el precio de un lote real para comprobar">
          <div className="flex items-center gap-2">
            <span className="text-sm text-stone-500">{currency === 'BOB' ? 'Bs' : '$us'}</span>
            <input
              type="number"
              min={0}
              step="1"
              value={samplePrice}
              onChange={(e) => setSamplePrice(Number(e.target.value))}
              className={`${inputBase} w-36`}
            />
          </div>
          {(() => {
            const preview = computeFinancing(
              samplePrice,
              parseFinancingPlan({ ...financing, enabled: true }),
              { currency, bobPerUsd: exchangeRate },
            );
            if (!preview) {
              return (
                <p className="mt-2 text-xs text-amber-700">
                  Con estos valores no se muestra ningún plan (revisa el precio, la cuota inicial y
                  el plazo).
                </p>
              );
            }
            return (
              <dl className="mt-2 rounded-lg bg-stone-50 px-3 py-2 text-sm">
                <div className="flex justify-between py-0.5">
                  <dt className="text-stone-500">
                    Cuota inicial ({formatPct(preview.downPaymentPct)})
                  </dt>
                  <dd className="font-semibold text-stone-800">
                    {formatMoney(preview.downPayment, preview.downPaymentCurrency)}
                  </dd>
                </div>
                <div className="flex justify-between py-0.5">
                  <dt className="text-stone-500">Cuota mensual ({formatTerm(preview.months)})</dt>
                  <dd className="font-bold text-brand">
                    {formatMoney(preview.monthly, currency)}
                  </dd>
                </div>
                <div className="flex justify-between py-0.5 text-xs">
                  <dt className="text-stone-400">Total pagado</dt>
                  <dd className="text-stone-500">{formatMoney(preview.totalPaid, currency)}</dd>
                </div>
              </dl>
            );
          })()}
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
