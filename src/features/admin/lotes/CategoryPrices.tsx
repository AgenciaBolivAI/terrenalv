'use client';

// Category price editor — the piece that was missing.
//
// Every lot's price is `price_override ?? price_per_m2 × área`, so with all five
// categories at 0.00 nothing was priceable and no screen existed to change that.
// Assigning a category simply produced 0 × área = 0, and the map showed
// "Precio por confirmar" on all 2.958 lots.
//
// pricing_categories already allows admin writes (RLS `categories_admin_write`)
// and every change is captured by the tg_audit_pricing_category trigger.

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { PricingCategory } from '@/lib/db-types';
import { computeFinancing, formatPct, type FinancingPlan } from '@/lib/financing';
import { formatMoney } from '@/lib/format';
import { useToast } from '@/features/admin/ui/toast';
import { inputBase } from '@/features/admin/ui/bits';

/** 300 m² (10 × 30) is the plano's dominant lot — makes the number concrete. */
const TYPICAL_AREA = 300;

export default function CategoryPrices({
  categories,
  currency,
  isAdmin,
  financing,
  onSaved,
}: {
  categories: PricingCategory[];
  currency: 'USD' | 'BOB';
  isAdmin: boolean;
  /** Current payment plan, so the price and its cuotas are read together. */
  financing: FinancingPlan | null;
  onSaved: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setDraft(Object.fromEntries(categories.map((c) => [c.id, String(c.price_per_m2 ?? 0)])));
  }, [categories]);

  const unpriced = categories.filter((c) => Number(c.price_per_m2) <= 0).length;

  async function save(cat: PricingCategory) {
    const raw = (draft[cat.id] ?? '').replace(',', '.').trim();
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      push('Precio inválido.', 'error');
      return;
    }
    setSaving(cat.id);
    const { error } = await supabase
      .from('pricing_categories')
      .update({ price_per_m2: value })
      .eq('id', cat.id);
    setSaving(null);
    if (error) {
      push('No se pudo guardar el precio.', 'error');
      return;
    }
    push(`Categoría ${cat.code}: ${formatMoney(value, currency)}/m²`, 'success');
    onSaved();
  }

  if (!categories.length) return null;

  return (
    <section className="mb-4 rounded-2xl border border-stone-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="min-w-0">
          <span className="text-sm font-bold text-stone-900">Categorías y precios</span>
          <span className="ml-2 text-xs text-stone-500">
            El precio de cada lote = precio/m² × superficie
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {unpriced > 0 ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
              {unpriced} sin precio
            </span>
          ) : null}
          <span className="text-stone-400">{open ? '▲' : '▼'}</span>
        </span>
      </button>

      {/* El precio y sus cuotas se deciden juntos, pero el plan vive en
          Configuración. Al menos que se vea desde aquí, y con un enlace. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-stone-100 px-4 py-2 text-xs">
        <span className="font-semibold text-stone-700">Plan de pago</span>
        {financing ? (
          <span className="text-stone-500">
            Cuota inicial{' '}
            {financing.down_payment_type === 'porcentaje'
              ? formatPct(financing.down_payment_value)
              : formatMoney(financing.down_payment_value, currency)}{' '}
            · {financing.months} cuotas
            {financing.annual_interest_pct > 0
              ? ` al ${formatPct(financing.annual_interest_pct)} anual`
              : ' sin interés'}
          </span>
        ) : (
          <span className="text-amber-700">No se muestra al comprador</span>
        )}
        <Link
          href="/admin/configuracion"
          className="ml-auto font-semibold text-brand hover:underline"
        >
          Editar plan
        </Link>
      </div>

      {open ? (
        <div className="border-t border-stone-100 px-4 py-3">
          {!isAdmin ? (
            <p className="text-sm text-stone-500">Solo un administrador puede cambiar precios.</p>
          ) : (
            <>
              <p className="mb-3 text-xs text-stone-500">
                Al cambiar el precio de una categoría, todos los lotes que la tengan asignada se
                actualizan al instante (salvo los que tengan precio manual).
              </p>
              <ul className="space-y-2">
                {categories.map((c) => {
                  const val = Number((draft[c.id] ?? '').replace(',', '.'));
                  const preview = Number.isFinite(val) && val > 0 ? val * TYPICAL_AREA : null;
                  const dirty = String(c.price_per_m2) !== (draft[c.id] ?? '');
                  return (
                    <li key={c.id} className="flex flex-wrap items-center gap-2">
                      <span
                        className="h-4 w-4 shrink-0 rounded ring-1 ring-stone-300"
                        style={{ background: c.color_hex }}
                        aria-hidden="true"
                      />
                      <span className="w-6 shrink-0 text-sm font-bold text-stone-700">{c.code}</span>
                      <input
                        inputMode="decimal"
                        value={draft[c.id] ?? ''}
                        onChange={(e) => setDraft((d) => ({ ...d, [c.id]: e.target.value }))}
                        className={`${inputBase} w-28`}
                        aria-label={`Precio por m² categoría ${c.code}`}
                      />
                      <span className="text-xs text-stone-500">/m²</span>
                      <span className="min-w-0 flex-1 text-xs text-stone-500">
                        {preview ? (
                          <>
                            un lote de {TYPICAL_AREA} m² = {formatMoney(preview, currency)}
                            {(() => {
                              const cuota = computeFinancing(preview, financing, { currency });
                              return cuota
                                ? ` · inicial ${formatMoney(cuota.downPayment, currency)} · ${formatMoney(cuota.monthly, currency)}/mes`
                                : '';
                            })()}
                          </>
                        ) : (
                          'sin precio → no reservable'
                        )}
                      </span>
                      <button
                        type="button"
                        disabled={!dirty || saving === c.id}
                        onClick={() => void save(c)}
                        className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                      >
                        {saving === c.id ? 'Guardando…' : 'Guardar'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
