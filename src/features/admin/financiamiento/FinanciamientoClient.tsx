'use client';

// Las condiciones de financiamiento, por rango de precio.
//
// Terrenalv no financia igual un lote de Bs 8.000 que uno de Bs 90.000: la
// cuota inicial que exige, el interés que cobra y el plazo que acepta cambian
// con la escala del lote. Eso vivía en la cabeza de quien vendía; acá se
// escribe una vez y la pantalla de venta lo aplica sola.
//
// Los rangos NO se pueden pisar: si dos clasificaciones cubren Bs 20.000, la
// condición que se aplica queda al azar del orden de la consulta. La base lo
// rechaza y acá se avisa antes.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/format';
import { cuotaDelPlan } from '@/lib/financing';
import {
  Badge,
  EmptyState,
  Spinner,
  btnDanger,
  btnPrimary,
  btnSecondary,
  inputClass,
} from '@/features/admin/ui/bits';
import { Dialog } from '@/features/admin/ui/dialog';
import { useToast } from '@/features/admin/ui/toast';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';

interface Tier {
  id: string;
  project_id: string | null;
  nombre: string;
  price_from: number;
  price_to: number | null;
  down_payment_pct: number;
  down_payment_min: number;
  monthly_interest_pct: number;
  max_months: number;
  is_active: boolean;
}

interface Proyecto {
  id: string;
  name: string;
}

export default function FinanciamientoClient({ projects }: { projects: Proyecto[] }) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const [rows, setRows] = useState<Tier[]>([]);
  const [loading, setLoading] = useState(true);
  const [editar, setEditar] = useState<Partial<Tier> | null>(null);
  const [borrar, setBorrar] = useState<Tier | null>(null);
  // El simulador: se teclea un precio y se ve qué le tocaría a ese lote.
  const [precio, setPrecio] = useState('30000');
  const [sim, setSim] = useState<Record<string, unknown> | null>(null);

  const cargar = useCallback(async () => {
    const { data } = await supabase
      .from('financing_tiers')
      .select('*')
      .order('project_id', { nullsFirst: true })
      .order('price_from');
    setRows((data ?? []) as unknown as Tier[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const simular = useCallback(async () => {
    const { data } = await supabase.rpc('condiciones_financiamiento', {
      p_project_id: null,
      p_price: Number(precio) || 0,
    });
    setSim((data as Record<string, unknown> | null) ?? null);
  }, [supabase, precio]);

  useEffect(() => {
    void simular();
  }, [simular]);

  async function guardar(t: Partial<Tier>) {
    const { error } = await supabase.rpc('admin_guardar_tier', {
      p_id: t.id ?? null,
      p_project_id: t.project_id ?? null,
      p_nombre: t.nombre ?? '',
      p_price_from: Number(t.price_from) || 0,
      p_price_to: t.price_to == null || String(t.price_to) === '' ? null : Number(t.price_to),
      p_down_pct: Number(t.down_payment_pct) || 0,
      p_down_min: Number(t.down_payment_min) || 0,
      p_interes_mensual: Number(t.monthly_interest_pct) || 0,
      p_max_meses: Number(t.max_months) || 60,
      p_activo: t.is_active ?? true,
    });
    if (error) {
      push(adminErrorCopy(error.message), 'error');
      return false;
    }
    push('Clasificación guardada.', 'success');
    setEditar(null);
    void cargar();
    void simular();
    return true;
  }

  async function eliminar(t: Tier) {
    const { error } = await supabase.rpc('admin_borrar_tier', { p_id: t.id });
    if (error) {
      push(adminErrorCopy(error.message), 'error');
      return;
    }
    push('Clasificación eliminada.', 'success');
    setBorrar(null);
    void cargar();
    void simular();
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-lg font-bold text-stone-900">Financiamiento</h1>
        <p className="text-xs text-stone-500">
          Cuánta cuota inicial se exige, cuánto interés se cobra y a cuántos meses, según el precio
          del lote.
        </p>
        <button type="button" className={`${btnPrimary} ml-auto`} onClick={() => setEditar({})}>
          Nueva clasificación
        </button>
      </div>

      {/* ---- El simulador: qué le toca a un lote de tal precio ---- */}
      <section className="rounded-xl border border-brand/30 bg-green-50/50 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">
              Probar con un lote de (Bs)
            </label>
            <input
              type="number"
              min={0}
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              className={`${inputClass} w-40`}
            />
          </div>
          {sim ? (
            <p className="text-sm text-stone-700">
              Le toca <strong>{String(sim.nombre)}</strong>: cuota inicial{' '}
              <strong>
                {formatMoney(Number(sim.inicial_sugerida), 'BOB')}
              </strong>{' '}
              ({String(sim.inicial_pct)}%), interés{' '}
              <strong>{String(sim.interes_mensual_pct)}% mensual</strong>, hasta{' '}
              <strong>{String(sim.max_meses)} meses</strong>.
              {(() => {
                const financiar =
                  (Number(precio) || 0) - Number(sim.inicial_sugerida ?? 0);
                const meses = Number(sim.max_meses) || 1;
                const c = cuotaDelPlan(financiar, Number(sim.interes_mensual_pct) || 0, meses);
                return financiar > 0 ? (
                  <>
                    {' '}
                    A {meses} meses la cuota sería{' '}
                    <strong className="tabular-nums">{formatMoney(c, 'BOB')}</strong> y se pagarían{' '}
                    <strong className="tabular-nums">
                      {formatMoney(Math.round((c * meses - financiar) * 100) / 100, 'BOB')}
                    </strong>{' '}
                    de interés en total.
                  </>
                ) : null;
              })()}
            </p>
          ) : (
            <p className="text-sm text-red-700">
              Ningún rango cubre ese precio: un lote así no tendría condiciones y habría que
              pactarlas a mano. Cubrí el hueco con una clasificación.
            </p>
          )}
        </div>
      </section>

      {rows.length === 0 ? (
        <EmptyState
          title="Sin clasificaciones"
          hint="Creá al menos una: sin rangos, cada venta a crédito se pacta a mano y nadie puede auditar por qué a uno le cobraron distinto."
        />
      ) : (
        <section className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50 text-left">
                <th className="px-4 py-2 text-xs font-semibold text-stone-500">Clasificación</th>
                <th className="px-3 py-2 text-xs font-semibold text-stone-500">Rango de precio</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                  Cuota inicial
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                  Interés mensual
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">
                  Plazo máx.
                </th>
                <th className="px-3 py-2 text-xs font-semibold text-stone-500">Alcance</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="border-b border-stone-100 last:border-0">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-stone-900">{t.nombre}</p>
                    {!t.is_active ? (
                      <Badge className="bg-stone-200 text-stone-600">inactiva</Badge>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-stone-600">
                    {formatMoney(Number(t.price_from), 'BOB')} —{' '}
                    {t.price_to == null ? 'sin techo' : formatMoney(Number(t.price_to), 'BOB')}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {Number(t.down_payment_pct)}%
                    {Number(t.down_payment_min) > 0
                      ? ` (mín. ${formatMoney(Number(t.down_payment_min), 'BOB')})`
                      : ''}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                    {Number(t.monthly_interest_pct)}%
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{t.max_months} meses</td>
                  <td className="px-3 py-2.5 text-xs text-stone-500">
                    {t.project_id
                      ? (projects.find((p) => p.id === t.project_id)?.name ?? 'Una urbanización')
                      : 'Toda la empresa'}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      type="button"
                      className="text-xs font-semibold text-brand hover:underline"
                      onClick={() => setEditar(t)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="ml-3 text-xs font-semibold text-red-600 hover:underline"
                      onClick={() => setBorrar(t)}
                    >
                      Borrar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-400">
            El interés es <strong>mensual sobre saldo</strong>: la cuota es fija y adentro lleva el
            interés del mes más el capital que corresponda. Al cobrar, el interés se cobra primero
            y el resto baja la deuda del lote. Los rangos no pueden pisarse.
          </p>
        </section>
      )}

      {editar ? (
        <EditarTierDialog
          tier={editar}
          projects={projects}
          onClose={() => setEditar(null)}
          onSave={guardar}
        />
      ) : null}

      {borrar ? (
        <Dialog open onClose={() => setBorrar(null)} title={`Borrar — ${borrar.nombre}`}>
          <p className="text-sm text-stone-600">
            Los planes ya creados con esta clasificación no cambian: guardaron su interés y su
            cuota al firmarse. Esto solo afecta a las ventas nuevas.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={btnSecondary} onClick={() => setBorrar(null)}>
              Volver
            </button>
            <button type="button" className={btnDanger} onClick={() => void eliminar(borrar)}>
              Borrar
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

/* ========================================================================== */

function EditarTierDialog({
  tier,
  projects,
  onClose,
  onSave,
}: {
  tier: Partial<Tier>;
  projects: Proyecto[];
  onClose: () => void;
  onSave: (t: Partial<Tier>) => Promise<boolean>;
}) {
  const [f, setF] = useState<Partial<Tier>>({
    monthly_interest_pct: 1.5,
    max_months: 48,
    down_payment_pct: 15,
    down_payment_min: 0,
    price_from: 0,
    is_active: true,
    ...tier,
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Tier, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  const ejemplo = useMemo(() => {
    const precio = Number(f.price_to) || Number(f.price_from) || 0;
    const inicial = Math.max(
      Math.round(precio * ((Number(f.down_payment_pct) || 0) / 100) * 100) / 100,
      Number(f.down_payment_min) || 0,
    );
    const financiar = Math.max(0, precio - inicial);
    const cuota = cuotaDelPlan(
      financiar,
      Number(f.monthly_interest_pct) || 0,
      Number(f.max_months) || 1,
    );
    return { precio, inicial, financiar, cuota };
  }, [f]);

  return (
    <Dialog open onClose={onClose} title={f.id ? 'Editar clasificación' : 'Nueva clasificación'}>
      <div className="space-y-3">
        <input
          value={f.nombre ?? ''}
          onChange={(e) => set('nombre', e.target.value)}
          placeholder="Nombre (ej. Lotes hasta Bs 10.000)"
          className={inputClass}
        />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Desde (Bs)</label>
            <input
              type="number"
              min={0}
              value={f.price_from ?? 0}
              onChange={(e) => set('price_from', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">
              Hasta (Bs) — vacío = sin techo
            </label>
            <input
              type="number"
              min={0}
              value={f.price_to ?? ''}
              onChange={(e) => set('price_to', e.target.value === '' ? null : e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Cuota inicial (%)</label>
            <input
              type="number"
              min={0}
              max={100}
              step="0.5"
              value={f.down_payment_pct ?? 0}
              onChange={(e) => set('down_payment_pct', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">Inicial mínima (Bs)</label>
            <input
              type="number"
              min={0}
              value={f.down_payment_min ?? 0}
              onChange={(e) => set('down_payment_min', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">Interés mensual (%)</label>
            <input
              type="number"
              min={0}
              max={20}
              step="0.1"
              value={f.monthly_interest_pct ?? 0}
              onChange={(e) => set('monthly_interest_pct', e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Plazo máximo (meses)</label>
            <input
              type="number"
              min={1}
              max={480}
              value={f.max_months ?? 48}
              onChange={(e) => set('max_months', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">Aplica a</label>
            <select
              value={f.project_id ?? ''}
              onChange={(e) => set('project_id', e.target.value || null)}
              className={inputClass}
            >
              <option value="">Toda la empresa</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={f.is_active ?? true}
            onChange={(e) => set('is_active', e.target.checked)}
            className="h-4 w-4"
          />
          Activa
        </label>

        {ejemplo.precio > 0 ? (
          <p className="rounded-lg bg-stone-50 p-3 text-xs text-stone-600">
            Con un lote de {formatMoney(ejemplo.precio, 'BOB')}: inicial{' '}
            <strong>{formatMoney(ejemplo.inicial, 'BOB')}</strong>, financia{' '}
            {formatMoney(ejemplo.financiar, 'BOB')}, y a {f.max_months} meses la cuota sería{' '}
            <strong className="tabular-nums">{formatMoney(ejemplo.cuota, 'BOB')}</strong>.
          </p>
        ) : null}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Volver
        </button>
        <button
          type="button"
          className={btnPrimary}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onSave(f);
            setBusy(false);
          }}
        >
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </Dialog>
  );
}
