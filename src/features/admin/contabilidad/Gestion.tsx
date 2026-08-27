'use client';

// Plan de cuentas, UFV / reexpresión monetaria y cierre de gestión.
//
// Las tres son tareas del contador, no del día a día: se tocan una vez al mes o
// una vez al año. Van juntas en una pestaña aparte para que no compitan con lo
// que la oficina usa a diario.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';
import { Badge, Spinner, btnPrimary, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { Dialog } from '@/features/admin/ui/dialog';
import { useToast } from '@/features/admin/ui/toast';
import { ExportButtons } from '@/features/admin/export/ExportButtons';
import { num, type Cell } from '@/features/admin/export';
import { dateLabel, todayIso } from './types';
import CentrosCosto from './CentrosCosto';
import type { Account } from './Comprobantes';

interface Period {
  id: string;
  year: number;
  starts_on: string;
  ends_on: string;
  status: 'abierto' | 'cerrado';
  closed_at: string | null;
}

interface Ufv {
  rate_date: string;
  value: number;
  source: string;
}

const KIND_LABEL: Record<string, string> = {
  activo: 'Activo',
  pasivo: 'Pasivo',
  patrimonio: 'Patrimonio',
  ingreso: 'Ingreso',
  gasto: 'Gasto',
};

export default function Gestion({
  projectId,
  projectName,
  accounts,
  onAccountsChanged,
}: {
  projectId: string;
  projectName: string;
  accounts: Account[];
  onAccountsChanged: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const [busy, setBusy] = useState(false);

  const [periods, setPeriods] = useState<Period[]>([]);
  const [ufvs, setUfvs] = useState<Ufv[]>([]);
  const [loading, setLoading] = useState(true);

  // Plan de cuentas
  const [accOpen, setAccOpen] = useState(false);
  const [accCode, setAccCode] = useState('');
  const [accName, setAccName] = useState('');
  const [accKind, setAccKind] = useState('activo');
  const [accError, setAccError] = useState<string | null>(null);

  // UFV
  const [ufvDate, setUfvDate] = useState(todayIso);
  const [ufvValue, setUfvValue] = useState('');

  // Reexpresión
  const [reDesde, setReDesde] = useState(`${new Date().getFullYear()}-01-01`);
  const [reHasta, setReHasta] = useState(todayIso);
  const [reCalc, setReCalc] = useState<{
    ufv_inicial: number | null; ufv_final: number | null;
    factor: number | null; patrimonio_inicial: number; ajuste: number | null;
  } | null>(null);

  const [year, setYear] = useState(new Date().getFullYear());

  const load = useCallback(async () => {
    setLoading(true);
    const [p, u] = await Promise.all([
      supabase.from('fiscal_periods').select('*').eq('project_id', projectId).order('year', { ascending: false }),
      supabase.from('ufv_rates').select('*').order('rate_date', { ascending: false }).limit(60),
    ]);
    setPeriods((p.data ?? []) as unknown as Period[]);
    setUfvs((u.data ?? []) as unknown as Ufv[]);
    setLoading(false);
  }, [supabase, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Lo que trae un plan de cuentas de verdad (el de Las Lomas, estilo
  // CONTAB): jerarquia con titulares e imputables, moneda por cuenta y la
  // marca de centro de costos. Una cuenta con padre hereda la naturaleza.
  const [accParent, setAccParent] = useState('');
  const [accMoneda, setAccMoneda] = useState<'BOB' | 'USD'>('BOB');
  const [accCCosto, setAccCCosto] = useState(false);

  async function guardarCuenta() {
    setAccError(null);
    if (!accCode.trim() || accName.trim().length < 2) {
      setAccError('Código y nombre son obligatorios.');
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc('admin_upsert_account', {
      p_code: accCode.trim(),
      p_name: accName.trim(),
      p_kind: accParent ? null : accKind,
      p_sort_order: null,
      p_parent_code: accParent || null,
      p_is_active: true,
      p_moneda: accMoneda,
      p_usa_centro_costo: accCCosto,
    });
    setBusy(false);
    if (error) {
      setAccError(adminErrorCopy(error.message));
      return;
    }
    push('Cuenta guardada.', 'success');
    setAccOpen(false);
    setAccCode('');
    setAccName('');
    onAccountsChanged();
  }

  async function bajaCuenta(a: Account) {
    if (!window.confirm(`¿Dar de baja la cuenta ${a.code} — ${a.name}?`)) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('admin_delete_account', { p_code: a.code });
    setBusy(false);
    if (error) {
      push(adminErrorCopy(error.message), 'error');
      return;
    }
    const r = data as { desactivada?: boolean; movimientos?: number } | null;
    push(
      r?.desactivada
        ? `La cuenta tiene ${r.movimientos} movimiento(s): quedó desactivada, no borrada.`
        : 'Cuenta eliminada.',
      'success',
    );
    onAccountsChanged();
  }

  async function guardarUfv() {
    const v = Number(ufvValue);
    if (!(v > 0)) {
      push('Valor de UFV inválido.', 'error');
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc('admin_set_ufv', {
      p_date: ufvDate,
      p_value: v,
      p_source: 'manual',
    });
    setBusy(false);
    if (error) {
      push(adminErrorCopy(error.message), 'error');
      return;
    }
    push('UFV registrada.', 'success');
    setUfvValue('');
    void load();
  }

  async function calcularReexpresion() {
    setBusy(true);
    const { data, error } = await supabase.rpc('rep_reexpresion', {
      p_project_id: projectId,
      p_desde: reDesde,
      p_hasta: reHasta,
    });
    setBusy(false);
    if (error) {
      push(adminErrorCopy(error.message), 'error');
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    setReCalc((row ?? null) as typeof reCalc);
  }

  async function asentarReexpresion() {
    setBusy(true);
    const { error } = await supabase.rpc('admin_post_reexpresion', {
      p_project_id: projectId,
      p_desde: reDesde,
      p_hasta: reHasta,
    });
    setBusy(false);
    if (error) {
      push(adminErrorCopy(error.message), 'error');
      return;
    }
    push('Ajuste por inflación registrado.', 'success');
    setReCalc(null);
  }

  async function cerrar() {
    if (!window.confirm(
      `¿Cerrar la gestión ${year}?\n\nSe generará el asiento de cierre y no se podrán ` +
      `registrar más comprobantes con fecha dentro del año.`,
    )) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('admin_close_period', {
      p_project_id: projectId,
      p_year: year,
      p_starts: `${year}-01-01`,
      p_ends: `${year}-12-31`,
    });
    setBusy(false);
    if (error) {
      push(adminErrorCopy(error.message), 'error');
      return;
    }
    const r = data as { number?: string; resultado?: number } | null;
    push(`Gestión ${year} cerrada (${r?.number}). Resultado: Bs ${num(Number(r?.resultado ?? 0))}.`, 'success');
    void load();
  }

  async function reabrir(p: Period) {
    const nota = window.prompt(`Motivo para reabrir la gestión ${p.year}:`);
    if (!nota?.trim()) return;
    setBusy(true);
    const { error } = await supabase.rpc('admin_reopen_period', {
      p_project_id: projectId,
      p_year: p.year,
      p_note: nota.trim(),
    });
    setBusy(false);
    if (error) {
      push(adminErrorCopy(error.message), 'error');
      return;
    }
    push(`Gestión ${p.year} reabierta. El asiento de cierre se eliminó.`, 'success');
    void load();
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ------------------------------ CENTROS DE COSTO ------------------ */}
      <CentrosCosto projectId={projectId} projectName={projectName} />

      {/* ------------------------------ PLAN DE CUENTAS ------------------- */}
      <section className="rounded-xl border border-stone-200 bg-white">
        <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 px-4 py-3">
          <div>
            <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
              Plan de cuentas
            </h2>
            <p className="mt-0.5 text-xs text-stone-500">
              Las marcadas «sistema» las usa el libro automático: se les puede cambiar el nombre,
              no la naturaleza ni el código.
            </p>
          </div>
          <div className="ml-auto flex gap-2">
            <ExportButtons
              disabled={!accounts.length}
              meta={{ title: 'Plan de Cuentas', subtitle: projectName, filename: `plan-de-cuentas-${todayIso()}` }}
              columns={[{ header: 'Código' }, { header: 'Nombre' }, { header: 'Tipo' }, { header: 'Estado' }]}
              rows={() =>
                accounts.map((a) => [
                  a.code, a.name, KIND_LABEL[a.kind] ?? a.kind, a.is_active ? 'activa' : 'inactiva',
                ]) as Cell[][]
              }
            />
            <button type="button" className={btnPrimary} onClick={() => setAccOpen(true)}>
              Nueva cuenta
            </button>
          </div>
        </div>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <tbody>
              {accounts.map((a) => (
                <tr key={a.code} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                  <td className="px-4 py-1.5 font-mono text-xs text-stone-600">{a.code}</td>
                  <td className={`px-3 py-1.5 ${a.is_active ? 'text-stone-800' : 'text-stone-400 line-through'}`}>
                    {a.name}
                  </td>
                  <td className="px-3 py-1.5">
                    <Badge className="bg-stone-100 text-stone-600">{KIND_LABEL[a.kind] ?? a.kind}</Badge>
                  </td>
                  <td className="px-3 py-1.5">
                    {a.is_system ? <span className="text-xs text-stone-400">sistema</span> : null}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {!a.is_system ? (
                      <button
                        type="button"
                        className={btnSecondary}
                        disabled={busy}
                        onClick={() => void bajaCuenta(a)}
                      >
                        Dar de baja
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ------------------------------ UFV ------------------------------- */}
      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
          UFV y reexpresión monetaria
        </h2>
        <p className="mt-0.5 text-xs text-stone-500">
          La UFV la publica el Banco Central. Se carga acá y el ajuste por inflación (AITB) se
          calcula con la variación entre las dos fechas.
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Fecha</label>
            <input type="date" value={ufvDate} onChange={(e) => setUfvDate(e.target.value)}
              className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">Valor (Bs por UFV)</label>
            <input type="number" step="0.00001" value={ufvValue} onChange={(e) => setUfvValue(e.target.value)}
              placeholder="3.33298"
              className="w-32 rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm" />
          </div>
          <button type="button" className={btnSecondary} disabled={busy} onClick={() => void guardarUfv()}>
            Guardar UFV
          </button>
          {ufvs.length ? (
            <p className="text-xs text-stone-500">
              Última cargada: {dateLabel(ufvs[0].rate_date)} = Bs {ufvs[0].value}
            </p>
          ) : (
            <p className="text-xs text-amber-700">Sin cotizaciones cargadas todavía.</p>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-stone-100 pt-4">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Desde</label>
            <input type="date" value={reDesde} onChange={(e) => setReDesde(e.target.value)}
              className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">Hasta</label>
            <input type="date" value={reHasta} onChange={(e) => setReHasta(e.target.value)}
              className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm" />
          </div>
          <button type="button" className={btnSecondary} disabled={busy} onClick={() => void calcularReexpresion()}>
            Calcular ajuste
          </button>
        </div>

        {reCalc ? (
          <div className="mt-3 rounded-lg bg-stone-50 p-3 text-sm">
            {reCalc.ufv_inicial === null || reCalc.ufv_final === null ? (
              <p className="text-amber-800">
                Faltan cotizaciones de UFV para esas fechas. Cargá al menos una anterior o igual a
                cada extremo del período.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div><p className="text-xs text-stone-500">UFV inicial</p><p className="font-semibold tabular-nums">{reCalc.ufv_inicial}</p></div>
                  <div><p className="text-xs text-stone-500">UFV final</p><p className="font-semibold tabular-nums">{reCalc.ufv_final}</p></div>
                  <div><p className="text-xs text-stone-500">Factor</p><p className="font-semibold tabular-nums">{reCalc.factor}</p></div>
                  <div><p className="text-xs text-stone-500">Ajuste</p><p className="font-semibold tabular-nums">Bs {num(Number(reCalc.ajuste ?? 0))}</p></div>
                </div>
                {Number(reCalc.ajuste ?? 0) === 0 ? (
                  <p className="mt-2 text-xs text-stone-500">
                    Sin patrimonio al inicio del período no hay nada que reexpresar.
                  </p>
                ) : (
                  <button type="button" className={`${btnPrimary} mt-3`} disabled={busy}
                    onClick={() => void asentarReexpresion()}>
                    Registrar asiento de ajuste
                  </button>
                )}
              </>
            )}
          </div>
        ) : null}
      </section>

      {/* ------------------------------ CIERRE ---------------------------- */}
      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
          Cierre de gestión
        </h2>
        <p className="mt-0.5 text-xs text-stone-500">
          Lleva ingresos y gastos a cero contra el Resultado de la Gestión y bloquea la carga de
          comprobantes con fecha dentro del año cerrado.
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Gestión</label>
            <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))}
              className="w-28 rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm" />
          </div>
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void cerrar()}>
            Cerrar gestión {year}
          </button>
        </div>

        {periods.length ? (
          <table className="mt-4 w-full text-sm">
            <tbody>
              {periods.map((p) => (
                <tr key={p.id} className="border-b border-stone-100 last:border-0">
                  <td className="py-2 font-semibold text-stone-800">{p.year}</td>
                  <td className="py-2 text-xs text-stone-500">
                    {dateLabel(p.starts_on)} — {dateLabel(p.ends_on)}
                  </td>
                  <td className="py-2">
                    <Badge className={p.status === 'cerrado' ? 'bg-stone-200 text-stone-700' : 'bg-green-100 text-green-700'}>
                      {p.status}
                    </Badge>
                  </td>
                  <td className="py-2 text-right">
                    {p.status === 'cerrado' ? (
                      <button type="button" className={btnSecondary} disabled={busy} onClick={() => void reabrir(p)}>
                        Reabrir
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-3 text-xs text-stone-400">Ninguna gestión cerrada todavía.</p>
        )}
      </section>

      <Dialog open={accOpen} onClose={() => setAccOpen(false)} title="Nueva cuenta">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-stone-500">Código</label>
              <input value={accCode} onChange={(e) => setAccCode(e.target.value)} placeholder="1211" className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">Naturaleza</label>
              <select value={accKind} onChange={(e) => setAccKind(e.target.value)} className={inputClass}>
                {Object.entries(KIND_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
          </div>
          <input value={accName} onChange={(e) => setAccName(e.target.value)} placeholder="Nombre de la cuenta" className={inputClass} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-stone-500">
                Cuelga de (titular)
              </label>
              <select
                value={accParent}
                onChange={(e) => setAccParent(e.target.value)}
                className={inputClass}
              >
                <option value="">— es de primer nivel —</option>
                {accounts
                  .filter((a) => a.is_active)
                  .map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} · {a.name}
                    </option>
                  ))}
              </select>
              <p className="mt-1 text-xs text-stone-400">
                Con padre, hereda su naturaleza. Una cuenta con hijas se vuelve
                titular: agrupa, pero ya no se asienta en ella.
              </p>
            </div>
            <div className="space-y-2">
              <div>
                <label className="mb-1 block text-xs text-stone-500">Moneda</label>
                <select
                  value={accMoneda}
                  onChange={(e) => setAccMoneda(e.target.value as 'BOB' | 'USD')}
                  className={inputClass}
                >
                  <option value="BOB">Bs. — moneda nacional</option>
                  <option value="USD">$us. — moneda extranjera</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-stone-700">
                <input
                  type="checkbox"
                  checked={accCCosto}
                  onChange={(e) => setAccCCosto(e.target.checked)}
                />
                Usa centro de costos
              </label>
            </div>
          </div>
          {accError ? <p className="text-sm text-red-600">{accError}</p> : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={() => setAccOpen(false)}>Volver</button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void guardarCuenta()}>
            {busy ? 'Guardando…' : 'Guardar cuenta'}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
