'use client';

// Comprobantes manuales (Reg. Comprobantes).
//
// Es lo que separa un sistema que ACOMPAÑA la contabilidad de uno que la
// reemplaza: todo lo que no es una venta, un cobro o un egreso —aportes de
// capital, depreciaciones, correcciones, provisiones— se registra acá.
//
// El asiento se escribe de arriba hacia abajo y recién se comprueba el cuadre
// al registrarlo. Validar línea por línea obligaría a pelearse con el
// formulario a la mitad de un asiento que todavía no terminó de escribirse.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { adminErrorCopy } from '@/features/admin/lib/errors-extra';
import { Badge, Spinner, btnPrimary, btnSecondary, inputClass } from '@/features/admin/ui/bits';
import { Dialog } from '@/features/admin/ui/dialog';
import { useToast } from '@/features/admin/ui/toast';
import { ExportButtons } from '@/features/admin/export/ExportButtons';
import { num, type Cell } from '@/features/admin/export';
import { dateLabel, todayIso } from './types';

export interface Account {
  code: string;
  name: string;
  kind: string;
  is_active: boolean;
  is_system: boolean;
}

interface EntryRow {
  id: string;
  number: string;
  kind: string;
  entry_date: string;
  glosa: string;
  status: 'borrador' | 'registrado' | 'anulado';
  is_automatic: boolean;
  journal_lines: { account_code: string; debe: number; haber: number; glosa: string | null }[];
}

interface DraftLine {
  account_code: string;
  debe: string;
  haber: string;
  glosa: string;
}

const KINDS = [
  ['ingreso', 'Ingreso'],
  ['egreso', 'Egreso'],
  ['traspaso', 'Traspaso'],
  ['ajuste', 'Ajuste'],
  ['apertura', 'Apertura'],
] as const;

const STATUS_BADGE: Record<EntryRow['status'], string> = {
  borrador: 'bg-amber-100 text-amber-800',
  registrado: 'bg-green-100 text-green-700',
  anulado: 'bg-stone-200 text-stone-500',
};

const EMPTY_LINE: DraftLine = { account_code: '', debe: '', haber: '', glosa: '' };

export default function Comprobantes({
  projectId,
  projectName,
  accounts,
}: {
  projectId: string;
  projectName: string;
  accounts: Account[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const { push } = useToast();
  const [rows, setRows] = useState<EntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [fecha, setFecha] = useState(todayIso);
  const [kind, setKind] = useState<string>('traspaso');
  const [glosa, setGlosa] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ ...EMPTY_LINE }, { ...EMPTY_LINE }]);
  const [error, setError] = useState<string | null>(null);

  const activos = accounts.filter((a) => a.is_active);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('journal_entries')
      .select('id, number, kind, entry_date, glosa, status, is_automatic, journal_lines(account_code, debe, haber, glosa)')
      .eq('project_id', projectId)
      .order('entry_date', { ascending: false })
      .limit(500);
    setRows((data ?? []) as unknown as EntryRow[]);
    setLoading(false);
  }, [supabase, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalDebe = lines.reduce((s, l) => s + (Number(l.debe) || 0), 0);
  const totalHaber = lines.reduce((s, l) => s + (Number(l.haber) || 0), 0);
  const cuadra = Math.abs(totalDebe - totalHaber) < 0.005 && totalDebe > 0;

  function nuevo() {
    setEditId(null);
    setFecha(todayIso());
    setKind('traspaso');
    setGlosa('');
    setLines([{ ...EMPTY_LINE }, { ...EMPTY_LINE }]);
    setError(null);
    setOpen(true);
  }

  function editar(e: EntryRow) {
    setEditId(e.id);
    setFecha(e.entry_date.slice(0, 10));
    setKind(e.kind);
    setGlosa(e.glosa);
    setLines(
      e.journal_lines.map((l) => ({
        account_code: l.account_code,
        debe: Number(l.debe) > 0 ? String(l.debe) : '',
        haber: Number(l.haber) > 0 ? String(l.haber) : '',
        glosa: l.glosa ?? '',
      })),
    );
    setError(null);
    setOpen(true);
  }

  function setLine(i: number, patch: Partial<DraftLine>) {
    setLines((prev) =>
      prev.map((l, idx) => {
        if (idx !== i) return l;
        const next = { ...l, ...patch };
        // Una línea es debe o haber, nunca las dos: escribir en una vacía la otra.
        if (patch.debe !== undefined && patch.debe !== '') next.haber = '';
        if (patch.haber !== undefined && patch.haber !== '') next.debe = '';
        return next;
      }),
    );
  }

  async function guardar(post: boolean) {
    setError(null);
    const payload = lines
      .filter((l) => l.account_code && (Number(l.debe) > 0 || Number(l.haber) > 0))
      .map((l) => ({
        account_code: l.account_code,
        debe: Number(l.debe) || 0,
        haber: Number(l.haber) || 0,
        glosa: l.glosa || null,
      }));

    if (post && payload.length < 2) {
      setError('Un asiento necesita al menos dos líneas.');
      return;
    }
    if (post && !cuadra) {
      setError(`No cuadra: debe ${num(totalDebe)} contra haber ${num(totalHaber)}.`);
      return;
    }

    setBusy(true);
    const { error: err } = await supabase.rpc('admin_save_voucher', {
      p_project_id: projectId,
      p_entry_date: fecha,
      p_kind: kind,
      p_glosa: glosa.trim(),
      p_lines: payload,
      p_entry_id: editId,
      p_post: post,
    });
    setBusy(false);
    if (err) {
      setError(adminErrorCopy(err.message));
      return;
    }
    push(post ? 'Comprobante registrado.' : 'Borrador guardado.', 'success');
    setOpen(false);
    void load();
  }

  async function anular(e: EntryRow) {
    const nota = window.prompt(`Motivo para anular ${e.number}:`);
    if (!nota?.trim()) return;
    setBusy(true);
    const { error: err } = await supabase.rpc('admin_void_voucher', {
      p_entry_id: e.id,
      p_note: nota.trim(),
    });
    setBusy(false);
    if (err) {
      push(adminErrorCopy(err.message), 'error');
      return;
    }
    push('Comprobante anulado.', 'success');
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
    <section className="rounded-xl border border-stone-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 px-4 py-3">
        <h2 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
          Comprobantes
        </h2>
        <div className="ml-auto flex gap-2">
          <ExportButtons
            disabled={!rows.length}
            orientation="landscape"
            meta={{
              title: 'Comprobantes',
              subtitle: projectName,
              filename: `comprobantes-${todayIso()}`,
            }}
            columns={[
              { header: 'Número' },
              { header: 'Fecha' },
              { header: 'Tipo' },
              { header: 'Glosa' },
              { header: 'Estado' },
              { header: 'Debe', align: 'right' },
            ]}
            rows={() =>
              rows.map((e) => [
                e.number,
                dateLabel(e.entry_date),
                e.kind,
                e.glosa,
                e.status,
                num(e.journal_lines.reduce((s, l) => s + Number(l.debe), 0)),
              ]) as Cell[][]
            }
          />
          <button type="button" className={btnPrimary} onClick={nuevo}>
            Nuevo comprobante
          </button>
        </div>
      </div>

      {!rows.length ? (
        <p className="py-10 text-center text-sm text-stone-400">
          Todavía no hay comprobantes manuales.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-200 text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50 text-left">
                <th className="px-4 py-2 text-xs font-semibold text-stone-500">Número</th>
                <th className="px-3 py-2 text-xs font-semibold text-stone-500">Fecha</th>
                <th className="px-3 py-2 text-xs font-semibold text-stone-500">Glosa</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-stone-500">Importe</th>
                <th className="px-3 py-2 text-xs font-semibold text-stone-500">Estado</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const importe = e.journal_lines.reduce((s, l) => s + Number(l.debe), 0);
                return (
                  <tr key={e.id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                    <td className="px-4 py-2 font-mono text-xs font-semibold text-stone-700">
                      {e.number}
                      {e.is_automatic ? (
                        <span className="ml-1 text-[10px] text-stone-400">auto</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-stone-600">
                      {dateLabel(e.entry_date)}
                    </td>
                    <td className="px-3 py-2 text-stone-800">{e.glosa}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{num(importe)}</td>
                    <td className="px-3 py-2">
                      <Badge className={STATUS_BADGE[e.status]}>{e.status}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1.5">
                        <button type="button" className={btnSecondary} onClick={() => editar(e)}>
                          {e.status === 'borrador' && !e.is_automatic ? 'Editar' : 'Ver'}
                        </button>
                        {e.status !== 'anulado' && !e.is_automatic ? (
                          <button
                            type="button"
                            className={btnSecondary}
                            disabled={busy}
                            onClick={() => void anular(e)}
                          >
                            Anular
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? 'Comprobante' : 'Nuevo comprobante'}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-stone-500">Fecha</label>
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">Tipo</label>
              <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputClass}>
                {KINDS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
          </div>
          <input
            value={glosa}
            onChange={(e) => setGlosa(e.target.value)}
            placeholder="Glosa (ej. Aporte de capital socios)"
            className={inputClass}
          />

          <div className="overflow-x-auto rounded-lg border border-stone-200">
            <table className="w-full min-w-150 text-sm">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50 text-left">
                  <th className="px-2 py-1.5 text-xs font-semibold text-stone-500">Cuenta</th>
                  <th className="px-2 py-1.5 text-xs font-semibold text-stone-500">Detalle</th>
                  <th className="px-2 py-1.5 text-right text-xs font-semibold text-stone-500">Debe</th>
                  <th className="px-2 py-1.5 text-right text-xs font-semibold text-stone-500">Haber</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-stone-100 last:border-0">
                    <td className="px-2 py-1">
                      <select
                        value={l.account_code}
                        onChange={(e) => setLine(i, { account_code: e.target.value })}
                        className="w-full rounded border border-stone-200 bg-white px-1.5 py-1 text-xs"
                      >
                        <option value="">—</option>
                        {activos.map((a) => (
                          <option key={a.code} value={a.code}>
                            {a.code} · {a.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <input
                        value={l.glosa}
                        onChange={(e) => setLine(i, { glosa: e.target.value })}
                        className="w-full rounded border border-stone-200 px-1.5 py-1 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="number" step="0.01" min={0} value={l.debe}
                        onChange={(e) => setLine(i, { debe: e.target.value })}
                        className="w-24 rounded border border-stone-200 px-1.5 py-1 text-right text-xs"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="number" step="0.01" min={0} value={l.haber}
                        onChange={(e) => setLine(i, { haber: e.target.value })}
                        className="w-24 rounded border border-stone-200 px-1.5 py-1 text-right text-xs"
                      />
                    </td>
                    <td className="px-2 py-1">
                      {lines.length > 2 ? (
                        <button
                          type="button"
                          aria-label="Quitar línea"
                          onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}
                          className="cursor-pointer px-1 text-stone-400 hover:text-red-600"
                        >
                          ✕
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={`border-t-2 ${cuadra ? 'border-green-300 bg-green-50' : 'border-stone-300 bg-stone-50'}`}>
                  <td className="px-2 py-2 text-xs font-semibold text-stone-600" colSpan={2}>
                    {cuadra ? '✓ Cuadra' : 'Debe y haber tienen que coincidir'}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums font-bold">{num(totalDebe)}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-bold">{num(totalHaber)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <button
            type="button"
            className={btnSecondary}
            onClick={() => setLines((p) => [...p, { ...EMPTY_LINE }])}
          >
            Agregar línea
          </button>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={() => setOpen(false)}>
            Volver
          </button>
          <button type="button" className={btnSecondary} disabled={busy} onClick={() => void guardar(false)}>
            Guardar borrador
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !cuadra} onClick={() => void guardar(true)}>
            {busy ? 'Registrando…' : 'Registrar'}
          </button>
        </div>
      </Dialog>
    </section>
  );
}
